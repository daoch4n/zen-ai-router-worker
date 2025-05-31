import json
import os
import sys
import time
import datetime
import urllib.parse
import traceback
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional, Iterable

# Third-party imports - these may show as unresolved in some IDEs
# but they are required dependencies for the script
try:
    import google.generativeai as Client
    from github import Github, GithubException
    import requests
    import fnmatch
    import jwt
    from unidiff import Hunk, PatchedFile, PatchSet
except ImportError as e:
    print(f"Error importing required dependencies: {e}")
    print("Please install required packages: pip install PyGithub google-generativeai PyJWT requests unidiff")
    sys.exit(1)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class GitHubAuthenticator:
    """
    Centralized class for handling GitHub authentication.
    Supports both GitHub App authentication and personal access token (GITHUB_TOKEN).
    """

    def __init__(self):
        self.app_id = "1281729"  # Hardcoded GitHub App ID for zen-ai-qa
        self.installation_id = os.environ.get("ZEN_APP_INSTALLATION_ID")
        self.token = None
        self.client = None

    def get_private_key(self):
        """
        Retrieve the private key using the most secure method available.
        Prioritizes file-based storage over environment variables.
        """
        # Check if we have a file path to the key
        if 'ZEN_APP_PRIVATE_KEY_PATH' in os.environ:
            try:
                with open(os.environ['ZEN_APP_PRIVATE_KEY_PATH'], 'r') as key_file:
                    return key_file.read()
            except Exception as e:
                logger.warning(f"Could not read private key from file: {e}")

        # Fall back to environment variable
        if 'ZEN_APP_PRIVATE_KEY' in os.environ:
            # Log that we're using the less secure method
            logger.info("Using private key from environment variable (less secure)")
            private_key = os.environ.get("ZEN_APP_PRIVATE_KEY")
            # Replace newline placeholders if the key was stored with them
            # Ensure private_key is not None before calling replace
            return private_key.replace('\\n', '\n') if private_key else None

        return None

    def generate_jwt_token(self):
        """
        Generate a JWT token for GitHub App authentication.

        Returns:
            str: JWT token for GitHub App authentication or None if failed
        """
        try:
            private_key = self.get_private_key()
            if not private_key:
                logger.error("No private key available for GitHub App authentication")
                return None

            # Create JWT payload
            now = int(time.time())
            payload = {
                'iat': now,                # Issued at time
                'exp': now + (10 * 60),    # JWT expiration time (10 minutes)
                'iss': self.app_id         # GitHub App's identifier
            }

            # Generate JWT token
            jwt_token = jwt.encode(payload, private_key, algorithm='RS256')

            # jwt.encode might return bytes in some versions of PyJWT
            if isinstance(jwt_token, bytes):
                jwt_token = jwt_token.decode('utf-8')

            logger.info(f"Successfully generated JWT token for GitHub App ID: {self.app_id}")
            return jwt_token
        except Exception as e:
            logger.error("Error generating JWT token: %s", e, exc_info=True)
            traceback.print_exc()
            return None

    def get_installation_access_token(self, jwt_token):
        """
        Get an installation access token for the GitHub App.

        Args:
            jwt_token (str): JWT token for GitHub App authentication

        Returns:
            str: Installation access token or None if failed
        """
        try:
            if not self.installation_id:
                logger.error("ZEN_APP_INSTALLATION_ID environment variable is required for GitHub App authentication")
                return None

            headers = {
                'Authorization': f'Bearer {jwt_token}',
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }

            url = f'https://api.github.com/app/installations/{self.installation_id}/access_tokens'
            response = requests.post(url, headers=headers)

            if response.status_code != 201:
                logger.error(f"Error getting installation access token. Status code: {response.status_code}")
                logger.error(f"Response: {response.text}")
                return None

            access_token = response.json().get('token')
            if not access_token:
                logger.error("No access token found in the response")
                return None

            logger.info(f"Successfully obtained installation access token for installation ID: {self.installation_id}")
            return access_token
        except Exception as e:
            logger.error("Error getting installation access token: %s", e, exc_info=True)
            traceback.print_exc()
            return None

    def authenticate(self):
        """
        Authenticate using either GitHub App credentials or GITHUB_TOKEN.

        Returns:
            tuple: (Github client, token) or (None, None) if authentication failed

        Raises:
            ValueError: If no valid authentication credentials are available
        """
        # Check if we're in test mode
        if os.environ.get("GEMINI_TEST_MODE") == "1":
            logger.info("Test mode: Skipping GitHub authentication")
            return None, None

        # Try GitHub App authentication first if credentials are available
        private_key = self.get_private_key()
        if self.app_id and self.installation_id and private_key:
            logger.info("GitHub App authentication credentials found. Using GitHub App authentication.")

            # Try to generate JWT token
            try:
                jwt_token = self.generate_jwt_token()
                if not jwt_token:
                    logger.error("Failed to generate JWT token for GitHub App authentication")
                    logger.info("Falling back to GITHUB_TOKEN due to JWT token generation failure")
                else:
                    # Try to get installation token
                    try:
                        installation_token = self.get_installation_access_token(jwt_token)
                        if not installation_token:
                            logger.error("Failed to get installation access token for GitHub App authentication")
                            logger.info("Falling back to GITHUB_TOKEN due to installation token retrieval failure")
                        else:
                            logger.info("Using GitHub App installation token for authentication")
                            self.token = installation_token
                            self.client = Github(installation_token)
                            return self.client, self.token
                    except Exception as e:
                        logger.error("Error getting installation access token: %s", e, exc_info=True)
                        logger.info("Falling back to GITHUB_TOKEN due to installation token error")
            except Exception as e:
                logger.error("Error during JWT token generation: %s", e, exc_info=True)
                logger.info("Falling back to GITHUB_TOKEN due to JWT generation error")
        else:
            # Log specific reason for not using GitHub App authentication
            if not self.app_id:
                logger.info("GitHub App ID not available. Falling back to GITHUB_TOKEN.")
            elif not self.installation_id:
                logger.info("GitHub App installation ID not available. Falling back to GITHUB_TOKEN.")
            elif not private_key:
                logger.info("GitHub App private key not available. Falling back to GITHUB_TOKEN.")
            else:
                logger.info("GitHub App authentication not available for unknown reason. Falling back to GITHUB_TOKEN.")

        # Fall back to GITHUB_TOKEN
        github_token = os.environ.get("GITHUB_TOKEN")
        if not github_token:
            logger.error("GITHUB_TOKEN environment variable is required when GitHub App authentication is not available")
            raise ValueError("No valid GitHub authentication credentials found")

        self.token = github_token
        self.client = Github(github_token)
        return self.client, self.token

# Initialize Gemini client
class GeminiKeyManager:
    """
    Class to manage Gemini API keys and handle rotation when rate limiting occurs.
    Supports multiple alternative keys (GEMINI_ALT_1 through GEMINI_ALT_4).
    """
    def __init__(self):
        # Initialize primary and fallback keys
        self.primary_key = os.environ.get("GEMINI_API_KEY")
        self.fallback_key = os.environ.get("GEMINI_FALLBACK_API_KEY")

        if not self.primary_key:
            logger.error("GEMINI_API_KEY environment variable is required")
            raise ValueError("GEMINI_API_KEY environment variable is required")

        # Set current key to primary initially
        self.current_key = self.primary_key
        self.current_key_name = "GEMINI_API_KEY"

        # Track rate limited keys and rotation order
        self.rate_limited_keys = set()
        self.encountered_rate_limiting = False
        self.all_keys_rate_limited = False
        self.used_fallback_key = False

        # Define rotation order: primary, then fallback if available
        self.rotation_order = ["GEMINI_API_KEY"]
        if self.fallback_key:
            self.rotation_order.append("GEMINI_FALLBACK_API_KEY")
            logger.info("Fallback API key is available for rotation.")
        else:
            logger.warning("No GEMINI_FALLBACK_API_KEY found. API key rotation will not be available.")

        # Log initialization status
        logger.info(f"Initialized GeminiKeyManager with primary key and {'a fallback key' if self.fallback_key else 'no fallback key'}")

    def get_current_key(self):
        """Get the currently active API key."""
        return self.current_key

    def get_current_key_name(self):
        """Get the name of the currently active API key."""
        return self.current_key_name

    def get_key_by_name(self, key_name):
        """Get an API key by its name."""
        if key_name == "GEMINI_API_KEY":
            return self.primary_key
        elif key_name == "GEMINI_FALLBACK_API_KEY":
            return self.fallback_key
        return None

    def rotate_key(self):
        """
        Rotate to the next available API key in sequence.
        Returns True if rotation was successful, False if no more keys are available.
        """
        self.rate_limited_keys.add(self.current_key_name)
        self.encountered_rate_limiting = True # Ensure this flag is set

        # Attempt to rotate to the fallback key if available and not already rate-limited
        if self.fallback_key and "GEMINI_FALLBACK_API_KEY" not in self.rate_limited_keys:
            logger.info(f"Rotating from {self.current_key_name} to GEMINI_FALLBACK_API_KEY due to rate limiting")
            self.current_key = self.fallback_key
            self.current_key_name = "GEMINI_FALLBACK_API_KEY"
            self.used_fallback_key = True
            return True
        else:
            # If fallback is not available or already rate-limited, all keys are exhausted
            logger.warning("All available API keys are rate limited or unavailable. Resetting to primary key.")
            self.current_key = self.primary_key
            self.current_key_name = "GEMINI_API_KEY"
            self.all_keys_rate_limited = True # Mark that all keys were rate limited
            self.rate_limited_keys.clear() # Clear the set to try again
            self.used_fallback_key = False # Reset fallback flag
            return False

    def is_rate_limit_error(self, error):
        """
        Check if an error is a rate limit error.
        """
        error_str = str(error).lower()
        is_rate_limit = (
            "429" in error_str or
            "quota" in error_str or
            "rate limit" in error_str or
            "resourceexhausted" in error_str
        )

        if is_rate_limit:
            # Mark that we've encountered rate limiting
            self.encountered_rate_limiting = True

            # Note: all_keys_rate_limited is set in rotate_key() when rotation fails
            # used_fallback_key is set in rotate_key() when rotation succeeds

        return is_rate_limit

# Global instance of the key manager
gemini_key_manager = None

def initialize_gemini_client():
    """
    Initialize the Gemini API client.

    Returns:
        module: Configured Gemini client module

    Raises:
        ValueError: If GEMINI_API_KEY is not available
    """
    global gemini_key_manager

    if os.environ.get("GEMINI_TEST_MODE") == "1":
        logger.info("Test mode: Skipping Gemini client initialization")
        return None

    # Initialize the key manager
    gemini_key_manager = GeminiKeyManager()

    # Configure the client with the initial key
    Client.configure(api_key=gemini_key_manager.get_current_key())
    return Client

# Initialize clients
try:
    # Create authenticator instance
    authenticator = GitHubAuthenticator()

    # Authenticate and get GitHub client
    gh, github_token = authenticator.authenticate()

    # Initialize Gemini client
    gemini_client_module = initialize_gemini_client()

    logger.info("Successfully initialized GitHub and Gemini clients")
except ValueError as e:
    logger.error("Initialization error: %s", e, exc_info=True)
    sys.exit(1)
except Exception as e:
    logger.error("Unexpected error during initialization: %s", e, exc_info=True)
    traceback.print_exc()
    sys.exit(1)


class ReviewContext:
    def __init__(self, owner: str, repo_name_str: str, event_type: str, repo_obj=None,
                 pull_number: Optional[int] = None, pr_obj=None,
                 commit_sha: Optional[str] = None, commit_obj=None,
                 title: Optional[str] = None, description: Optional[str] = None):
        self.owner = owner
        self.repo_name = repo_name_str
        self.event_type = event_type
        self.repo_obj = repo_obj
        self.pull_number = pull_number
        self.pr_obj = pr_obj
        self.commit_sha = commit_sha
        self.commit_obj = commit_obj
        self.title = title
        self.description = description

    def get_full_repo_name(self):
        return f"{self.owner}/{self.repo_name}"

def get_review_context() -> ReviewContext:
    github_event_path = os.environ.get("GITHUB_EVENT_PATH")
    if not github_event_path:
        logger.error("Error: GITHUB_EVENT_PATH environment variable not set.")
        sys.exit(1)

    with open(github_event_path, "r", encoding="utf-8") as f:
        event_data = json.load(f)

    event_name = os.environ.get("GITHUB_EVENT_NAME")
    repo_full_name = event_data["repository"]["full_name"]
    owner, repo_name_str = repo_full_name.split("/")
    repo_obj = None
    try:
        repo_obj = gh.get_repo(repo_full_name) if gh else None
    except GithubException as e:
        logger.error("Error accessing GitHub repository: %s", e, exc_info=True)
        sys.exit(1)
    except Exception as e:
        logger.error("An unexpected error occurred while fetching repo details: %s", e, exc_info=True)
        sys.exit(1)

    if event_name == "pull_request":
        pull_number = event_data["pull_request"]["number"]
        pr_obj = None
        try:
            pr_obj = repo_obj.get_pull(pull_number) if repo_obj else None
        except GithubException as e:
            logger.error("Error accessing GitHub PR: %s", e, exc_info=True)
            sys.exit(1)
        except Exception as e:
            logger.error("An unexpected error occurred while fetching PR details: %s", e, exc_info=True)
            sys.exit(1)

        pr_title = pr_obj.title if pr_obj else ""
        pr_body = pr_obj.body if pr_obj else ""
        logger.info(f"Detected event type: pull_request (action: {event_data.get('action')})")
        return ReviewContext(owner, repo_name_str, "pull_request", repo_obj, pull_number, pr_obj,
                             title=pr_title, description=pr_body)

    elif event_name == "push":
        commit_sha = os.environ.get("GITHUB_SHA")
        before_sha = os.environ.get("GITHUB_BEFORE")
        if not commit_sha:
            logger.error("Error: GITHUB_SHA environment variable not set for push event.")
            sys.exit(1)

        commit_obj = None
        try:
            commit_obj = repo_obj.get_commit(commit_sha) if repo_obj else None
        except GithubException as e:
            logger.error("Error accessing GitHub commit: %s", e, exc_info=True)
            sys.exit(1)
        except Exception as e:
            logger.error("An unexpected error occurred while fetching commit details: %s", e, exc_info=True)
            sys.exit(1)

        commit_message = commit_obj.commit.message if commit_obj and commit_obj.commit else ""
        logger.info(f"Detected event type: push. Commit SHA: {commit_sha}")
        return ReviewContext(owner, repo_name_str, "push", repo_obj,
                             commit_sha=commit_sha, commit_obj=commit_obj,
                             title=f"Commit: {commit_message.splitlines()[0] if commit_message.strip() else 'No Commit Title'}", description=commit_message)

    elif event_name == "issue_comment":
        if "issue" in event_data and "pull_request" in event_data["issue"]:
            pull_number = event_data["issue"]["number"]
            pr_obj = None
            try:
                pr_obj = repo_obj.get_pull(pull_number) if repo_obj else None
            except GithubException as e:
                logger.error("Error accessing GitHub PR for issue_comment: %s", e, exc_info=True)
                sys.exit(1)
            pr_title = pr_obj.title if pr_obj else ""
            pr_body = pr_obj.body if pr_obj else ""
            logger.info(f"Detected event type: issue_comment on PR #{pull_number}")
            return ReviewContext(owner, repo_name_str, "issue_comment", repo_obj, pull_number, pr_obj,
                                 title=pr_title, description=pr_body)
        else:
            logger.error("Error: issue_comment event not on a pull request.")
            sys.exit(1)
    else:
        logger.error(f"Error: Unsupported GITHUB_EVENT_NAME: {event_name}")
        sys.exit(1)


def get_diff(review_context: ReviewContext, comparison_sha: Optional[str] = None) -> str:
    """
    Get the diff for a PR, with multiple fallback strategies.

    Args:
        pr_details: PRDetails object containing PR information
        comparison_sha: Optional SHA to compare against HEAD

    Returns:
        str: The diff text or empty string if all methods fail
    """
    repo = review_context.repo_obj
    pr = review_context.pr_obj
    head_sha = None
    if review_context.event_type == "pull_request" and review_context.pr_obj:
        head_sha = review_context.pr_obj.head.sha
    elif review_context.event_type == "push" and review_context.commit_obj:
        head_sha = review_context.commit_sha # Use the current commit SHA for push events

    # Strategy 1: Use repo.compare if comparison_sha is provided
    if comparison_sha:
        logger.info(f"Getting diff comparing HEAD ({head_sha}) against specified SHA ({comparison_sha})")
        try:
            comparison_obj = repo.compare(comparison_sha, head_sha) if repo and head_sha else None
            diff_parts = []
            # Ensure comparison_obj is not None before accessing its 'files' attribute
            if comparison_obj and comparison_obj.files:
                for file_diff in comparison_obj.files:
                    if file_diff.patch:
                        # Construct a valid diff header format for unidiff
                        source_file_path_for_header = file_diff.previous_filename if file_diff.status == 'renamed' else file_diff.filename
                        target_file_path_for_header = file_diff.filename

                    diff_header = f"diff --git a/{source_file_path_for_header} b/{target_file_path_for_header}\n"
                    if file_diff.status == 'added':
                        diff_header += f"new file mode {getattr(file_diff, 'mode', '100644')}\n"
                        diff_header += f"index 0000000..{file_diff.sha[:7]}\n"
                    elif file_diff.status == 'deleted':
                        diff_header += f"deleted file mode {getattr(file_diff, 'mode', '100644')}\n"
                        diff_header += f"index {file_diff.sha[:7]}..0000000\n"
                    elif file_diff.status == 'renamed':
                        diff_header += f"similarity index {getattr(file_diff, 'similarity_index', '100')}%\n"
                        diff_header += f"rename from {source_file_path_for_header}\n" # already set as prev_filename
                        diff_header += f"rename to {target_file_path_for_header}\n"   # already set as filename
                        if hasattr(file_diff, 'sha'): # If it's a rename with modifications
                             diff_header += f"index {getattr(file_diff, 'previous_sha', '0000000')[:7]}..{file_diff.sha[:7]}\n"
                    elif file_diff.status == 'modified':
                         # For modified files, the index line shows old SHA..new SHA
                         # PyGithub's file_diff.sha is the new SHA. We need the old one if available,
                         # or rely on the patch content itself to have it.
                         # For simplicity, we'll rely on the patch content for modified index line.
                         pass

                    patch_content = file_diff.patch

                    # Ensure --- and +++ lines are present, this is critical for unidiff
                    # The patch from GitHub API usually has these, but repo.compare() might be different.
                    lines = patch_content.splitlines()
                    final_patch_lines = []

                    # Simplification: Assume file_diff.patch from repo.compare is the core hunk data
                    # and we need to wrap it correctly for unidiff.
                    final_patch_lines.append(f"--- a/{source_file_path_for_header}")
                    final_patch_lines.append(f"+++ b/{target_file_path_for_header}")
                    final_patch_lines.extend(lines) # Add the actual patch lines (hunks)

                    diff_parts.append(diff_header + "\n".join(final_patch_lines))

            if diff_parts:
                diff_text = "\n".join(diff_parts) # Each element in diff_parts is a full diff for one file
                logger.info(f"Retrieved diff (length: {len(diff_text)}) using repo.compare('{comparison_sha}', '{head_sha}')")
                return diff_text
            else:
                logger.info(f"No changes found comparing {comparison_sha} to {head_sha}")
                return ""
        except GithubException as e:
            logger.warning(f"Error getting comparison diff (compare {comparison_sha} vs {head_sha}): {e}. Falling back.")
        except Exception as e:
            logger.error("Unexpected error during repo.compare: %s. Falling back.", e, exc_info=True)
            traceback.print_exc()

    # Strategy 2: Use pr.get_diff() (only for PRs)
    if review_context.event_type == "pull_request" and review_context.pr_obj:
        logger.info(f"Falling back to pr.get_diff() for PR #{review_context.pull_number}")
        try:
            diff_text = review_context.pr_obj.get_diff() # This is usually well-formatted for unidiff
            if diff_text:
                logger.info(f"Retrieved diff (length: {len(diff_text)}) using pr.get_diff()")
                return diff_text
            else:
                logger.warning("pr.get_diff() returned no content.")
                return ""
        except GithubException as e:
            logger.warning(f"Error getting diff using pr.get_diff(): {e}. Falling back further.")
        except Exception as e:
            logger.error("Unexpected error during pr.get_diff(): %s. Falling back further.", e, exc_info=True)

    # Strategy 3: Use direct API request with proper authentication
    # This strategy can be adapted for both PRs and commits if needed, but for now,
    # it's primarily used as a fallback for PR diffs.
    api_url = ""
    if review_context.event_type == "pull_request" and review_context.pull_number:
        logger.info(f"Falling back to direct API request for PR diff for PR #{review_context.pull_number}")
        api_url = f"https://api.github.com/repos/{review_context.get_full_repo_name()}/pulls/{review_context.pull_number}"
    elif review_context.event_type == "push" and comparison_sha and review_context.commit_sha:
        logger.info(f"Falling back to direct API request for commit diff for {review_context.commit_sha}")
        # For commits, GitHub API provides a compare endpoint:
        # GET /repos/{owner}/{repo}/compare/{basehead}
        api_url = f"https://api.github.com/repos/{review_context.get_full_repo_name()}/compare/{comparison_sha}...{review_context.commit_sha}"
    else:
        logger.error("Cannot determine API URL for diff based on review context.")
        return ""

    # Use the global authenticator instance for authentication
    headers = {
        'Accept': 'application/vnd.github.v3.diff'
    }

    # Get a fresh token from the authenticator
    try:
        # Create a new authenticator instance for this request
        request_auth = GitHubAuthenticator()
        _, token = request_auth.authenticate()

        if token:
            headers['Authorization'] = f'token {token}'
        else:
            # Last resort: try to use GITHUB_TOKEN directly
            github_token = os.environ.get("GITHUB_TOKEN")
            if github_token:
                logger.warning("Using GITHUB_TOKEN directly for API request as authenticator failed")
                headers['Authorization'] = f'token {github_token}'
            else:
                logger.error("No authentication token available for API request")
                return ""
    except Exception as auth_error:
        logger.error(f"Authentication error for direct API request: {auth_error}")
        # Last resort: try to use GITHUB_TOKEN directly
        github_token = os.environ.get("GITHUB_TOKEN")
        if github_token:
            logger.warning("Using GITHUB_TOKEN directly for API request after authentication error")
            headers['Authorization'] = f'token {github_token}'
        else:
            logger.error("No authentication token available for API request")
            return ""

    # Make the API request
    try:
        response = requests.get(api_url, headers=headers, timeout=30)
        response.raise_for_status()
        diff_text = response.text
        logger.info(f"Retrieved diff (length: {len(diff_text)}) via direct API call.")
        return diff_text
    except requests.exceptions.RequestException as e:
        logger.error("Failed to get diff via direct API call: %s", e, exc_info=True)
    except Exception as e:
        logger.error("Unexpected error during direct API call for diff: %s", e, exc_info=True)

    logger.error("All methods to retrieve diff failed.")
    return ""


def get_hunk_representation(hunk: Hunk) -> str:
    return str(hunk)


def get_file_content(file_path: str) -> str:
    full_file_content = ""
    code_extensions = [
        ".py", ".js", ".jsx", ".ts", ".tsx", ".html", ".css", ".scss", ".java",
        ".c", ".cpp", ".h", ".hpp", ".go", ".rs", ".php", ".rb", ".sh", ".bash",
        ".json", ".yml", ".yaml", ".toml", ".md"
    ]
    is_code_file = any(file_path.endswith(ext) for ext in code_extensions)

    if not is_code_file:
        print(f"Skipping full file context for non-code or binary-like file: {file_path}")
        return ""

    try:
        p_file_path = Path(file_path)
        if p_file_path.exists() and p_file_path.is_file():
            file_stat = p_file_path.stat()
            max_initial_read_bytes = 300000

            if file_stat.st_size > max_initial_read_bytes:
                print(f"File {file_path} is very large ({file_stat.st_size} bytes). Reading a truncated version for context.")
                with open(p_file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    start_content = f.read(max_initial_read_bytes // 2)
                full_file_content = start_content + "\n\n... [content truncated due to very large size] ...\n\n"
            else:
                 with open(p_file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    full_file_content = f.read()

            max_char_len_for_context = 150000
            if len(full_file_content) > max_char_len_for_context:
                print(f"File content for {file_path} still too long after initial read ({len(full_file_content)} chars), further truncating for Gemini context.")
                half_len = max_char_len_for_context // 2
                full_file_content = full_file_content[:half_len] + \
                                    "\n\n... [content context truncated for brevity] ...\n\n" + \
                                    full_file_content[-half_len:]

            print(f"Read file content for {file_path} (length: {len(full_file_content)} chars after potential truncation).")
        else:
            print(f"File {file_path} does not exist locally or is not a file. Cannot provide full context.")
    except Exception as e:
        print(f"Error reading full file content for {file_path}: {e}")
        traceback.print_exc()
    return full_file_content


def load_previous_review_data(filepath_str: str = "reviews/gemini-pr-review.json") -> Dict[str, Any]:
    """Load previous review data from JSON file if it exists."""
    filepath = Path(filepath_str)
    if not filepath.exists():
        print(f"Previous review file {filepath_str} not found. No previous context will be provided.")
        return {}

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
            print(f"Successfully loaded previous review data from {filepath_str}")
            return data
    except Exception as e:
        print(f"Error loading previous review data from {filepath_str}: {e}")
        return {}


def get_previous_file_comments(review_data: Dict[str, Any], file_path: str) -> List[Dict[str, Any]]:
    """Extract previous comments for a specific file from the review data."""
    if not review_data or "review_comments" not in review_data:
        return []

    file_comments = []
    for comment in review_data.get("review_comments", []):
        comment_text = comment.get("comment_text_md", "")
        if comment.get("file_path") == file_path and "[IGNORED]" not in comment_text:
            file_comments.append(comment)

    print(f"Found {len(file_comments)} previous comments for file {file_path}")
    return file_comments


def create_batch_prompt(patched_file: PatchedFile, review_context: ReviewContext) -> str:
    full_file_content_for_context = get_file_content(patched_file.path)

    # Load previous review data (adjust filepath based on event type)
    review_data_filepath = "reviews/gemini-pr-review.json" if review_context.event_type == "pull_request" else "reviews/gemini-commit-review.json"
    previous_review_data = load_previous_review_data(filepath_str=review_data_filepath)
    previous_file_comments = get_previous_file_comments(previous_review_data, patched_file.path)

    combined_hunks_text = ""
    for i, hunk in enumerate(patched_file):
        hunk_text = get_hunk_representation(hunk)
        if not hunk_text.strip():
            continue

        separator = ("-" * 20) + f" Hunk {i+1} (0-indexed: {i}) " + ("-" * 20) + "\n"
        combined_hunks_text += ("\n\n" if i > 0 else "") + separator + hunk_text

    # Adjust instructions based on event type
    review_type_instruction = "pull requests" if review_context.event_type == "pull_request" else "code commits"
    # Escape any literal '%' characters in review_type_instruction for f-string
    escaped_review_type_instruction = review_type_instruction.replace('%', '%%')
    instructions = f"""Your task is reviewing {escaped_review_type_instruction}. You will provide structured output in JSON format.

REVIEW GUIDELINES:
- Focus on logic flaws, inconsistencies, and bugs that would affect how the application runs. These include:
  * Incorrect error handling or recovery strategies
  * Race conditions or state management issues
  * Inconsistent behavior between related components
  * Performance bottlenecks in critical paths
  * Security vulnerabilities
- Also consider code structure and maintainability issues:
  * Violations of SOLID principles or other key design patterns
  * Redundant code that could be refactored
  * Unclear logic that could lead to future bugs
- Lower priority issues include:
  * Naming conventions (only if they cause genuine confusion)
  * Documentation suggestions (only for complex logic)

IMPORTANT GUIDELINES:
- Make comments actionable with specific suggestions for improvement. Include pseudocode examples when possible.
- DO NOT comment on minor style issues or suggest adding comments to the code itself.
- Carefully analyze the full file context (if provided) and PR context before making suggestions.
- Only suggest changes relevant to the diff. Do not comment on unrelated code unless directly impacted by the changes.
- Be concise and clear in your feedback.
- If no issues are found, return an empty reviews array.

HANDLING PREVIOUS REVIEW COMMENTS:
- If my previous review comments are provided, check if they've been addressed in the current code.
- If you see "[ADDRESSED]" in a previous comment, verify the fix is correct and DO NOT repeat the issue.
- If a previous issue has been partially fixed, acknowledge the improvement and suggest any remaining changes.
- If a previous issue hasn't been addressed at all, you may note it again but focus on new issues.
- If a fix for a previous issue introduces new problems, highlight those specifically.

RESPONSE FORMAT:
Your response must be a valid JSON object with the following structure:
{
  "reviews": [
    {
      "hunkIndex": 0,  // 0-based index of the hunk in the diff (matches the 'Hunk X (0-indexed: Y)' header)
      "lineNumber": 1, // 1-based line number within the hunk content (first line after the '@@ ... @@' header)
      "reviewComment": "Your review comment in GitHub Markdown format",
      "confidence": "High" // "High", "Medium", or "Low" based on your certainty and the potential impact
    },
    // Additional review items as needed
  ]
}

IMPORTANT NOTES ABOUT LINE NUMBERS:
- The hunkIndex must be a valid 0-based index within the range of hunks in the diff
- The lineNumber must be a valid 1-based line number within the content of the specified hunk
- If you're unsure about the exact line number, choose the first line of the relevant code block
- Do not specify line numbers outside the range of the hunk content

The response will be automatically structured according to the schema provided in the API configuration.
"""

    # Contextualize prompt based on event type
    context_header = ""
    context_description = ""
    if review_context.event_type == "pull_request":
        context_header = f"\nPull Request Title: {review_context.title}\nPull Request Description:\n---\n"
        context_description = review_context.description or 'No description provided.'
    elif review_context.event_type == "push":
        context_header = f"\nCommit Title: {review_context.title}\nCommit Message:\n---\n"
        context_description = review_context.description or 'No commit message provided.'
    else: # issue_comment or other
        context_header = f"\nReview Context Title: {review_context.title}\nReview Context Description:\n---\n"
        context_description = review_context.description or 'No description provided.'

    review_context_block = f"{context_header}{context_description}\n---\n"

    # Add previous review context if available
    previous_review_context = ""
    if previous_file_comments:
        previous_review_context = "\n## My Previous Review Comments for this file:\n"
        for i, comment in enumerate(previous_file_comments):
            comment_text = comment.get('comment_text_md', 'N/A')
            # Check if the comment has been marked as addressed
            is_addressed = "[ADDRESSED]" in comment_text
            status_marker = "✅ ADDRESSED" if is_addressed else "⏳ PENDING"

            previous_review_context += f"### Comment {i+1}: {status_marker}\n"
            previous_review_context += f"- **File**: {comment.get('file_path')}\n"
            previous_review_context += f"- **Category**: {comment.get('detected_category_heuristic', 'N/A')}\n"
            previous_review_context += f"- **Severity**: {comment.get('detected_severity_heuristic', 'N/A')}\n"
            previous_review_context += f"- **Content**: {comment_text}\n\n"

            # If the comment has been addressed, try to extract the resolution note
            if is_addressed:
                resolution_start = comment_text.find("[ADDRESSED]")
                resolution_text = comment_text[resolution_start:]
                if "**Resolution**:" in resolution_text:
                    resolution_note = resolution_text.split("**Resolution**:", 1)[1].strip()
                    previous_review_context += f"- **Resolution Note**: {resolution_note}\n\n"

    file_context_header = ""
    file_content_block = ""
    if full_file_content_for_context:
        file_context_header = "\nFull content of the file for better context (it may be truncated if too large):\n"
        file_ext = Path(patched_file.path).suffix[1:]
        file_content_block = f"```{file_ext or 'text'}\n{full_file_content_for_context}\n```\n"

    diff_to_review_header = f"\nReview the following code diffs for the file \"{patched_file.path}\" ({len(list(patched_file))} hunks):\n"
    diff_block = f"```diff\n{combined_hunks_text}\n```"

    return instructions + review_context_block + previous_review_context + file_context_header + file_content_block + diff_to_review_header + diff_block


LAST_GEMINI_REQUEST_TIME = 0
GEMINI_RPM_LIMIT = 45
GEMINI_REQUEST_INTERVAL_SECONDS = 60.0 / GEMINI_RPM_LIMIT

def enforce_gemini_rate_limits():
    global LAST_GEMINI_REQUEST_TIME
    current_time = time.time()
    time_since_last = current_time - LAST_GEMINI_REQUEST_TIME
    if time_since_last < GEMINI_REQUEST_INTERVAL_SECONDS:
        wait_time = GEMINI_REQUEST_INTERVAL_SECONDS - time_since_last
        print(f"Gemini Rate Limiter: Waiting {wait_time:.2f} seconds.")
        time.sleep(wait_time)
    LAST_GEMINI_REQUEST_TIME = time.time()


def process_structured_output(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Process the structured output from the Gemini API."""
    # Validate the structure
    if not isinstance(data, dict) or "reviews" not in data or not isinstance(data["reviews"], list):
        print(f"Error: Structured output has invalid structure. Expected {{'reviews': [...]}}. Got: {type(data)}")
        return []

    # Process the reviews
    valid_reviews = []
    for i, review_item in enumerate(data["reviews"]):
        # Validate the review item
        if not isinstance(review_item, dict):
            print(f"Error: Review item {i} is not a dict: {review_item}")
            continue

        required_keys = ["hunkIndex", "lineNumber", "reviewComment", "confidence"]
        if not all(k in review_item for k in required_keys):
            print(f"Error: Review item {i} missing one or more required keys ({', '.join(required_keys)}): {review_item}")
            continue

        # Ensure types are correct
        try:
            # Convert to integers if needed
            if not isinstance(review_item["hunkIndex"], int):
                review_item["hunkIndex"] = int(review_item["hunkIndex"])
            if not isinstance(review_item["lineNumber"], int):
                review_item["lineNumber"] = int(review_item["lineNumber"])
        except (ValueError, TypeError) as e:
            print(f"Error: Review item {i} hunkIndex or lineNumber not convertible to int: {review_item}, error: {e}")
            continue

        # Validate confidence
        if review_item["confidence"] not in ["High", "Medium", "Low"]:
            print(f"Warning: Review item {i} has invalid confidence '{review_item.get('confidence')}'. Defaulting to Low.")
            review_item["confidence"] = "Low"

        valid_reviews.append(review_item)

    print(f"Successfully processed {len(valid_reviews)} valid review items from structured output.")
    return valid_reviews


def improved_calculate_github_position(file_patch: PatchedFile, hunk_idx: int, line_num_in_hunk: int) -> Optional[int]:
    """
    Improved function to calculate GitHub position for a comment.

    This function handles line number calculation more robustly by:
    1. Getting the actual hunk object by index
    2. Validating the line number is within the hunk's content range
    3. Calculating the position based on the hunk's position in the diff
    """
    try:
        # Get all hunks in the file
        hunks_in_file = list(file_patch)

        # Validate hunk index
        if not (0 <= hunk_idx < len(hunks_in_file)):
            print(f"Warning: Invalid hunk index {hunk_idx} for file {file_patch.path} (has {len(hunks_in_file)} hunks)")
            return None

        # Get the target hunk
        target_hunk = hunks_in_file[hunk_idx]

        # Get the number of lines in the hunk
        hunk_lines = list(target_hunk)
        num_lines_in_hunk = len(hunk_lines)

        # Validate line number
        if not (1 <= line_num_in_hunk <= num_lines_in_hunk):
            print(f"Warning: Line number {line_num_in_hunk} is outside the range of hunk content (1-{num_lines_in_hunk})")
            return None

        # Calculate position based on hunk position and line number
        position = 0

        # Add positions for all hunks before the target hunk
        for i in range(hunk_idx):
            position += 1  # For the hunk header
            position += len(list(hunks_in_file[i]))

        # Add position for the target hunk header
        position += 1

        # Add position for the line within the target hunk
        position += line_num_in_hunk - 1

        return position

    except Exception as e:
        print(f"Error calculating GitHub position: {e}")
        traceback.print_exc()
        return None


def get_ai_response_with_structured_output(prompt: str, model_name: str, max_retries: int = 3) -> List[Dict[str, Any]]:
    """
    Get AI response with improved structured output handling.

    This function uses Gemini's structured output feature with proper error handling
    and fallback mechanisms. It also handles rate limiting by rotating API keys.
    """
    global gemini_key_manager

    if not gemini_client_module:
        print("Error: Gemini client module not initialized. Cannot make API call.")
        return []

    if not gemini_key_manager:
        print("Error: Gemini key manager not initialized. Cannot make API call.")
        return []

    # Define the schema for review items
    review_item_schema = {
        "type": "object",
        "properties": {
            "hunkIndex": {"type": "integer", "description": "0-based index of the hunk in the diff"},
            "lineNumber": {"type": "integer", "description": "1-based line number within the hunk content"},
            "reviewComment": {"type": "string", "description": "The review comment text in GitHub Markdown format"},
            "confidence": {"type": "string", "enum": ["High", "Medium", "Low"], "description": "Confidence level of the review comment"}
        },
        "required": ["hunkIndex", "lineNumber", "reviewComment", "confidence"]
    }

    # Define the overall response schema
    response_schema = {
        "type": "object",
        "properties": {
            "reviews": {
                "type": "array",
                "items": review_item_schema,
                "description": "Array of review comments for the PR"
            }
        },
        "required": ["reviews"]
    }

    # Log the prompt length
    print(f"Full prompt (length {len(prompt)}). Start:\n{prompt[:1000]}...\n...End:\n{prompt[-1000:]}")

    for attempt in range(1, max_retries + 1):
        try:
            # Create the model with structured output configuration and current API key
            # We recreate the model on each attempt to ensure we're using the current API key
            Client.configure(api_key=gemini_key_manager.get_current_key())

            gemini_model = gemini_client_module.GenerativeModel(
                model_name,
                generation_config={
                    "max_output_tokens": 8192,
                    "temperature": 0.4,
                    "top_p": 0.95,
                    "top_k": 40,
                    "response_mime_type": "application/json",  # Enable structured output
                    "response_schema": response_schema  # Define the expected response structure
                },
                safety_settings=[
                    {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
                    {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
                    {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
                    {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
                ]
            )

            enforce_gemini_rate_limits()
            # Only show first 5 chars of key followed by *** for security
            # Ensure get_current_key() returns a string before slicing
            current_key_value = gemini_key_manager.get_current_key()
            key_prefix = current_key_value[:5] if current_key_value else "None"
            print(f"Attempt {attempt}/{max_retries} - Sending prompt to Gemini model {model_name} with structured output using key: {key_prefix}***")

            # Generate content with the prompt
            response = gemini_model.generate_content(prompt)

            if not response.parts:
                print(f"Warning: AI response (attempt {attempt}) was empty or blocked.")
                if attempt < max_retries:
                    time.sleep((2 ** attempt) * 2)
                    continue
                return []

            # Check if we have a structured output response
            if hasattr(response, 'candidates') and response.candidates:
                candidate = response.candidates[0]
                if hasattr(candidate, 'content') and hasattr(candidate.content, 'parts'):
                    part = candidate.content.parts[0]
                    if hasattr(part, 'function_call') and part.function_call and hasattr(part.function_call, 'parsed'):
                        print("Received structured output response with function_call.parsed attribute.")
                        data = part.function_call.parsed
                        # Process the structured output
                        return process_structured_output(data)

            # Check if we have a parsed response (structured output)
            if hasattr(response, 'parsed'):
                print("Received structured output response with parsed attribute.")
                data = response.parsed
                # Process the structured output
                return process_structured_output(data)

            # Fallback to text parsing if structured output is not available
            print("Structured output not available. Falling back to text parsing.")
            response_text = response.text.strip()

            # Clean up the response text if it's wrapped in markdown code blocks
            if response_text.startswith("```json"):
                response_text = response_text[len("```json"):]
            if response_text.endswith("```"):
                response_text = response_text[:-len("```")]
            response_text = response_text.strip()

            # Parse the JSON
            data = json.loads(response_text)

            # Process the parsed JSON
            return process_structured_output(data)

        except json.JSONDecodeError as e:
            print(f"Error decoding JSON from AI response (attempt {attempt}): {e}")
            if attempt < max_retries:
                time.sleep(2 ** attempt)
                continue
            return []
        except Exception as e:
            print(f"Error during Gemini API call (attempt {attempt}): {type(e).__name__} - {e}")

            # Check if this is a rate limit error
            if gemini_key_manager.is_rate_limit_error(e):
                print(f"Detected rate limit error: {e}")

                # Log available keys status (without exposing full keys)
                # Log available keys status (without exposing full keys)
                key_status_info = []
                if gemini_key_manager.primary_key:
                    key_status_info.append(f"GEMINI_API_KEY: {'SET' if gemini_key_manager.primary_key else 'NOT SET'}")
                if gemini_key_manager.fallback_key:
                    key_status_info.append(f"GEMINI_FALLBACK_API_KEY: {'SET' if gemini_key_manager.fallback_key else 'NOT SET'}")

                print(f"API key status - {', '.join(key_status_info)}")
                print(f"Currently using: {gemini_key_manager.get_current_key_name()}")

                # Try to rotate to the next available key
                if gemini_key_manager.rotate_key():
                    # Only show first 5 chars of key followed by *** for security
                    # Ensure get_current_key() returns a string before slicing
                    current_key_value = gemini_key_manager.get_current_key()
                    key_prefix = current_key_value[:5] if current_key_value else "None"
                    print(f"Rotated to alternative API key {gemini_key_manager.get_current_key_name()}: {key_prefix}***")
                    # Don't increment attempt counter when we rotate keys
                    continue
                else:
                    print("All API keys are rate limited or unavailable")

            # For non-rate-limit errors or if key rotation failed, continue with normal retry logic
            if attempt < max_retries:
                time.sleep(5 * attempt)
                continue
            return []

    return []


def get_ai_response_with_retry(prompt: str, max_retries: int = 3) -> List[Dict[str, Any]]:
    """
    Get AI response with structured output and retry mechanism.

    This function has been updated to use Gemini's structured output feature as described in:
    https://ai.google.dev/gemini-api/docs/structured-output

    The structured output approach constrains the model to generate JSON that matches our schema,
    which should improve reliability and reduce parsing errors.
    """
    model_name = os.environ.get('GEMINI_MODEL', 'gemini-1.5-flash-latest')

    if not gemini_client_module:
        print("Error: Gemini client module not initialized. Cannot make API call.")
        return []

    # Use the improved structured output handling function
    print("Using improved structured output handling function")
    enforce_gemini_rate_limits()
    return get_ai_response_with_structured_output(prompt, model_name, max_retries)


def analyze_code(files_to_review: Iterable[PatchedFile], review_context: ReviewContext) -> List[Dict[str, Any]]:
    files_list = list(files_to_review)
    print(f"Starting code analysis for {len(files_list)} files.")
    all_comments_for_pr = []

    for patched_file in files_list:
        if not patched_file.path or patched_file.path == "/dev/null":
            print(f"Skipping file with invalid path: {patched_file.path}")
            continue

        hunks_in_file = list(patched_file)
        if not hunks_in_file:
            print(f"No hunks in file {patched_file.path}, skipping.")
            continue

        print(f"\nProcessing file: {patched_file.path} with {len(hunks_in_file)} hunks.")

        batch_prompt = create_batch_prompt(patched_file, review_context)
        ai_reviews_for_file = get_ai_response_with_retry(batch_prompt)

        if ai_reviews_for_file:
            print(f"Received {len(ai_reviews_for_file)} review suggestions from AI for file {patched_file.path}.")
            file_comments = process_batch_ai_reviews(patched_file, ai_reviews_for_file)
            if file_comments:
                all_comments_for_pr.extend(file_comments)
        else:
            print(f"No review suggestions from AI for file {patched_file.path}.")

    print(f"\nFinished analysis. Total comments generated for PR: {len(all_comments_for_pr)}")
    return all_comments_for_pr


def get_hunk_header_str(hunk: Hunk) -> str:
    # A Hunk's string representation starts with its header: "@@ -old_start,old_len +new_start,new_len @@"
    # Or constructs it if not directly available.
    # For logging, it's useful.
    return f"@@ -{hunk.source_start},{hunk.source_length} +{hunk.target_start},{hunk.target_length} @@"


# Function removed as it's redundant - process_batch_ai_reviews will call improved_calculate_github_position directly


def process_batch_ai_reviews(patched_file: PatchedFile, ai_reviews: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    comments_for_github = []
    hunks_in_file = list(patched_file)

    for review_detail in ai_reviews:
        try:
            hunk_idx_from_ai = review_detail["hunkIndex"]
            line_num_in_hunk_content = review_detail["lineNumber"]
            comment_text = review_detail["reviewComment"]
            confidence = review_detail["confidence"]

            if not (0 <= hunk_idx_from_ai < len(hunks_in_file)):
                print(f"Warning: AI returned out-of-bounds hunkIndex {hunk_idx_from_ai} for file {patched_file.path} "
                      f"(has {len(hunks_in_file)} hunks). Skipping comment.")
                continue

            # Call improved_calculate_github_position directly with the hunk index
            github_pos_result = improved_calculate_github_position(patched_file, hunk_idx_from_ai, line_num_in_hunk_content)

            if github_pos_result is None:
                print(f"Warning: Could not calculate GitHub position for comment in {patched_file.path}, "
                      f"Hunk Index {hunk_idx_from_ai}, Line {line_num_in_hunk_content}. Skipping.")
                continue

            formatted_comment_body = f"**My Confidence: {confidence}**\n\n{comment_text}"

            # If github_pos_result is None, it means the position couldn't be calculated precisely
            if github_pos_result is None:
                # For invalid positions, we'll add a special prefix to the comment
                formatted_comment_body = (
                    "**Note: I couldn't precisely position this comment in the diff, but I think it's important feedback:**\n\n"
                    f"**My Confidence: {confidence}**\n\n{comment_text}"
                )
                # Add the comment to the list of comments to post at the file level (position=1)
                gh_comment = {
                    "body": formatted_comment_body,
                    "path": patched_file.path,
                    "position": 1,  # File-level comment
                    "confidence_raw": confidence,
                    "invalidPosition": True  # Add flag for tracking
                }
            else:
                # Normal case with valid position
                gh_comment = {
                    "body": formatted_comment_body,
                    "path": patched_file.path,
                    "position": github_pos_result,
                    "confidence_raw": confidence
                }

            comments_for_github.append(gh_comment)

        except KeyError as e:
            print(f"Error processing AI review item due to missing key {e}: {review_detail}")
        except Exception as e:
            print(f"Unexpected error processing AI review item {review_detail}: {e}")
            traceback.print_exc()

    return comments_for_github


def save_review_results_to_json(review_context: ReviewContext, comments: List[Dict[str, Any]], filepath_str: str = "reviews/gemini-pr-review.json") -> str:
    filepath = Path(filepath_str)
    filepath.parent.mkdir(parents=True, exist_ok=True)

    # Get API key info for metadata
    api_key_info = "primary"
    rate_limited = False # Default to False

    if gemini_key_manager:
        if gemini_key_manager.current_key_name == "GEMINI_FALLBACK_API_KEY":
            api_key_info = "fallback (rotated due to rate limiting)"
        # Check if ALL keys were rate limited (for commit message)
        rate_limited = gemini_key_manager.all_keys_rate_limited

    review_data = {
        "metadata": {
            "event_type": review_context.event_type,
            "repo": review_context.get_full_repo_name(),
            "title": review_context.title,
            "timestamp_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "review_tool": "zen-ai-qa",
            "model_used": os.environ.get('GEMINI_MODEL', 'N/A'),
            "api_key_used": api_key_info,
            "rate_limited": rate_limited
        },
        "review_comments": []
    }
    if review_context.event_type == "pull_request":
        review_data["metadata"]["pull_number"] = review_context.pull_number
    elif review_context.event_type == "push":
        review_data["metadata"]["commit_sha"] = review_context.commit_sha

    for gh_comment_dict in comments:
        structured_comment = {
            "file_path": gh_comment_dict["path"],
            "github_diff_position": gh_comment_dict["position"],
            "comment_text_md": gh_comment_dict["body"],
            "ai_confidence": gh_comment_dict.get("confidence_raw", "N/A"),
            "detected_severity_heuristic": detect_severity(gh_comment_dict["body"]),
            "detected_category_heuristic": detect_category(gh_comment_dict["body"])
        }

        # Include invalidPosition flag if present
        if gh_comment_dict.get("invalidPosition"):
            structured_comment["invalidPosition"] = True

        review_data["review_comments"].append(structured_comment)

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(review_data, f, indent=2)

    print(f"Review results saved to {filepath}")
    return str(filepath)


def detect_severity(comment_text: str) -> str:
    """Heuristically detect the severity of a comment based on its content and confidence level."""
    lower_text = comment_text.lower()

    # Extract confidence level if present
    confidence = "medium"  # Default
    if "**ai confidence: high**" in lower_text:
        confidence = "high"
    elif "**ai confidence: medium**" in lower_text:
        confidence = "medium"
    elif "**ai confidence: low**" in lower_text:
        confidence = "low"

    # Check for critical severity indicators - highest priority runtime issues
    if any(word in lower_text for word in [
        "critical", "security vulnerability", "crash", "exploit", "must fix",
        "data loss", "deadlock", "race condition", "memory leak", "infinite loop"
    ]):
        return "critical"

    # Check for high severity indicators - focus on runtime issues
    if any(word in lower_text for word in [
        "bug", "error", "incorrect", "wrong", "security", "potential vulnerability",
        "flaw", "exception", "broken", "incorrect behavior", "inconsistent behavior"
    ]):
        return "high"

    # Check for medium severity indicators - focus on code quality and maintainability
    if any(word in lower_text for word in [
        "performance", "optimization", "memory", "leak", "consider fixing",
        "confusing", "unclear", "inefficient", "redundant", "duplicate"
    ]):
        # Upgrade to high if confidence is high
        if confidence == "high":
            return "high"
        return "medium"

    # Check for low severity indicators - minor improvements
    if any(word in lower_text for word in [
        "style", "formatting", "naming", "convention", "documentation",
        "comment", "clarity", "suggestion", "consider", "might", "could"
    ]):
        # Upgrade based on confidence
        if confidence == "high":
            return "medium"
        return "low"

    # Use confidence level as a fallback
    if confidence == "high":
        return "medium"
    elif confidence == "medium":
        return "low"

    # Default to low severity
    return "low"

def detect_category(comment_text: str) -> str:
    """Categorize review comments based on their content with improved focus on runtime issues."""
    lower_text = comment_text.lower()

    # Runtime behavior categories - highest priority
    if any(word in lower_text for word in [
        "security", "vulnerability", "exploit", "auth", "csrf", "xss",
        "injection", "password", "secret", "encryption", "authentication"
    ]):
        return "security"

    if any(word in lower_text for word in [
        "race condition", "deadlock", "concurrency", "thread safety",
        "synchronization", "atomic", "lock", "mutex", "semaphore"
    ]):
        return "concurrency"

    if any(word in lower_text for word in [
        "bug", "error", "incorrect", "wrong", "fix", "defect", "exception",
        "nullpointer", "undefined", "crash", "broken", "inconsistent behavior"
    ]):
        return "bug"

    if any(word in lower_text for word in [
        "memory leak", "resource leak", "file handle", "connection",
        "not closed", "not released", "not disposed"
    ]):
        return "resource-management"

    # Performance and optimization
    if any(word in lower_text for word in [
        "performance", "slow", "optimization", "efficient", "memory",
        "cpu", "latency", "resource", "bottleneck", "timeout", "delay"
    ]):
        return "performance"

    # Code quality categories
    if any(word in lower_text for word in [
        "error handling", "exception handling", "try/catch", "recovery",
        "fallback", "resilience", "robustness"
    ]):
        return "error-handling"

    if any(word in lower_text for word in [
        "refactor", "clean", "simplify", "maintainability", "design", "architecture",
        "pattern", "anti-pattern", "duplication", "redundant", "duplicate"
    ]):
        return "refactoring/design"

    if any(word in lower_text for word in [
        "state management", "state machine", "lifecycle", "initialization",
        "cleanup", "side effect"
    ]):
        return "state-management"

    # Lower priority categories
    if any(word in lower_text for word in [
        "test", "coverage", "assertion", "mocking", "unit test",
        "integration test", "e2e test"
    ]):
        return "testing"

    if any(word in lower_text for word in [
        "style", "format", "naming", "convention", "readability", "clarity",
        "understandability", "documentation", "commenting"
    ]):
        return "style/clarity"

    # Default category
    return "general"


def create_review_and_summary_comment(review_context: ReviewContext, comments_for_gh_review: List[Dict[str, Any]], review_json_path: str):
    """
    Create a review with comments and a summary comment on the PR.

    Args:
        pr_details: PRDetails object containing PR information
        comments_for_gh_review: List of comments to add to the review
        review_json_path: Path to the JSON file containing the review data
    """
    # Determine the target object for comments (PR or Commit)
    target_obj = None
    if review_context.event_type == "pull_request" and review_context.pr_obj:
        target_obj = review_context.pr_obj
        logger.info(f"Targeting PR #{review_context.pull_number} for comments.")
    elif review_context.event_type == "push" and review_context.commit_obj:
        # Ensure repo_obj is not None before calling get_commit
        if review_context.repo_obj:
            target_obj = review_context.repo_obj.get_commit(review_context.commit_sha)
            logger.info(f"Targeting commit {review_context.commit_sha} for comments.")
        else:
            logger.error("Repository object not available for push event. Cannot target commit for comments.")
            return # Exit if repo_obj is None
    elif review_context.event_type == "issue_comment" and review_context.pr_obj:
        target_obj = review_context.pr_obj
        logger.info(f"Targeting PR #{review_context.pull_number} for comments (from issue_comment event).")
    else:
        logger.error("No valid target object (PR or Commit) available for comments. Cannot create review or comments.")
        return

    num_suggestions = len(comments_for_gh_review)

    # Re-authenticate if necessary for posting comments
    # This block is similar to the one above, but for comment posting
    try:
        # First try to use the global gh client which should already be authenticated
        if gh and hasattr(gh, '_Github__requester') and hasattr(gh._Github__requester, 'auth'):
            auth_header = getattr(gh._Github__requester.auth, 'token', '')
            if auth_header and os.environ.get("ZEN_APP_INSTALLATION_ID"):
                # We're already authenticated with the bot identity
                if review_context.event_type == "pull_request" and review_context.pr_obj:
                    repo = gh.get_repo(review_context.get_full_repo_name())
                    target_obj = repo.get_pull(review_context.pull_number)
                    logger.info(f"Using globally authenticated client with bot identity for PR #{review_context.pull_number}")
                elif review_context.event_type == "push" and review_context.commit_obj:
                    repo = gh.get_repo(review_context.get_full_repo_name())
                    target_obj = repo.get_commit(review_context.commit_sha)
                    logger.info(f"Using globally authenticated client with bot identity for commit {review_context.commit_sha}")
            else:
                logger.info("Global client not authenticated with bot identity, attempting to use bot credentials")
                review_auth = GitHubAuthenticator()
                github_client, token = review_auth.authenticate()

                if github_client and token:
                    if review_context.event_type == "pull_request" and review_context.pr_obj:
                        repo = github_client.get_repo(review_context.get_full_repo_name())
                        target_obj = repo.get_pull(review_context.pull_number)
                        logger.info(f"Successfully authenticated with bot identity for PR #{review_context.pull_number}")
                    elif review_context.event_type == "push" and review_context.commit_obj:
                        repo = github_client.get_repo(review_context.get_full_repo_name())
                        target_obj = repo.get_commit(review_context.commit_sha)
                        logger.info(f"Successfully authenticated with bot identity for commit {review_context.commit_sha}")
                else:
                    logger.warning("Bot authentication failed. Using original target object.")
        else:
            logger.warning("Global GitHub client not properly initialized. Using original target object.")
    except Exception as auth_error:
        logger.error(f"Error during GitHub authentication for comments: {auth_error}")
        logger.warning("Falling back to original target object due to error.")

    # Process and post review comments
    if num_suggestions > 0:
        valid_review_comments = []
        for c in comments_for_gh_review:
            if all(k in c for k in ["body", "path", "position"]):
                if isinstance(c["position"], int) and isinstance(c["path"], str) and isinstance(c["body"], str):
                    valid_review_comments.append({
                        "body": c["body"],
                        "path": c["path"],
                        "position": c["position"]
                    })
                else:
                    logger.warning(f"Skipping malformed comment due to type mismatch: {c}")
            else:
                logger.warning(f"Skipping malformed comment due to missing keys: {c}")

        if valid_review_comments:
            if review_context.event_type == "pull_request" and review_context.pr_obj:
                try:
                    logger.info(f"Creating a PR review with {len(valid_review_comments)} suggestions.")
                    target_obj.create_review(
                        body="I've reviewed your code and have some suggestions:",
                        event="COMMENT",
                        comments=valid_review_comments
                    )
                    logger.info("Successfully created PR review with suggestions.")
                except GithubException as e:
                    logger.error("Error creating PR review: %s (Status: %s, Data: %s)", e, getattr(e, 'status', 'N/A'), getattr(e, 'data', 'N/A'), exc_info=True)
                    logger.warning("Falling back to posting individual issue comments for suggestions.")
                    for c_item in valid_review_comments:
                        try:
                            # For PRs, issue comments are tied to the PR number
                            target_obj.create_issue_comment(f"I found an issue in **File:** `{c_item['path']}` (at diff position {c_item['position']})\n\n{c_item['body']}")
                        except Exception as ie:
                            logger.error("Error posting individual suggestion as issue comment: %s", ie, exc_info=True)
                except Exception as e:
                    logger.error("Unexpected error during PR review creation: %s", e, exc_info=True)
                    traceback.print_exc()
            elif review_context.event_type == "push" and review_context.commit_obj:
                # For push events, comments are posted directly on the commit
                logger.info(f"Creating {len(valid_review_comments)} comments on commit {review_context.commit_sha}.")
                for c_item in valid_review_comments:
                    try:
                        # Commit comments require path, position, and commit_id
                        # The 'position' here is the position in the diff, which needs to be calculated
                        # relative to the target commit.
                        # For now, we'll simplify and post as general commit comments if direct diff comment is complex.
                        # GitHub API for commit comments: POST /repos/{owner}/{repo}/commits/{commit_sha}/comments
                        # This requires `path` and `position` relative to the diff of that commit.
                        # The `position` from our `improved_calculate_github_position` is for PR diffs.
                        # For simplicity, we'll post general comments on the commit, or if we want file-specific,
                        # we can try `create_comment` on the commit object.
                        # The `position` parameter for `create_comment` on a commit refers to the line number in the *file*,
                        # not the diff position. This is a key difference.
                        # For now, let's post as a general comment on the commit, mentioning the file and diff position.
                        target_obj.create_comment(
                            body=f"I found an issue in **File:** `{c_item['path']}` (at diff position {c_item['position']})\n\n{c_item['body']}",
                            path=c_item['path'], # Path relative to the repository root
                            position=c_item['position'], # Line number in the file (not diff position)
                            commit_id=review_context.commit_sha
                        )
                        logger.info(f"Posted comment on commit {review_context.commit_sha} for file {c_item['path']}.")
                    except GithubException as e:
                        logger.error("Error posting commit comment for %s: %s (Status: %s, Data: %s)", c_item['path'], e, getattr(e, 'status', 'N/A'), getattr(e, 'data', 'N/A'), exc_info=True)
                    except Exception as e:
                        logger.error("Unexpected error posting commit comment for %s: %s", c_item['path'], e, exc_info=True)
                        traceback.print_exc()
            else:
                logger.warning("No validly structured comments to create a review with.")
        else:
            logger.info("No suggestions to create a review for.")

    # Prepare summary comment with links to review file
    repo_full_name = os.environ.get("GITHUB_REPOSITORY", review_context.get_full_repo_name())
    server_url = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
    
    review_file_url_md = f"Review JSON file (`{review_json_path}` in the repository)"
    
    # Determine the branch name for the URL based on event type
    branch_name = None
    if review_context.event_type == "pull_request" and review_context.pr_obj:
        branch_name = review_context.pr_obj.head.ref
    elif review_context.event_type == "push":
        # For push events, the branch name is available in GITHUB_REF
        # GITHUB_REF for a push to main will be 'refs/heads/main'
        github_ref = os.environ.get("GITHUB_REF")
        if github_ref and github_ref.startswith("refs/heads/"):
            branch_name = github_ref.replace("refs/heads/", "")
        elif github_ref and github_ref.startswith("refs/tags/"):
            # For tags, we might not want to link to a branch, or link to the commit SHA directly
            logger.warning(f"Push event was for a tag: {github_ref}. Cannot form branch URL.")
            branch_name = None # Do not form a branch URL
    
    if branch_name:
        try:
            encoded_branch = urllib.parse.quote_plus(branch_name)
            review_file_url = f"{server_url}/{repo_full_name}/blob/{encoded_branch}/{review_json_path}"
            review_file_url_md = f"Full review details in [`{review_json_path}`]({review_file_url})"
            logger.info(f"Summary comment will link to: {review_file_url}")
        except Exception as url_e:
            logger.error(f"Error creating review file URL: {url_e}")
    else:
        logger.warning("Could not determine branch name for summary comment URL. Link will be generic.")

    # Create summary body with categorized findings
    summary_body = f"✨ **I've completed my code review!** ✨\n\n"
    if num_suggestions > 0:
        # Group comments by category and severity for better organization
        comments_by_category = {}
        for c in comments_for_gh_review:
            if "body" not in c:
                continue

            # Extract category and severity
            category = detect_category(c["body"])
            severity = detect_severity(c["body"])

            if category not in comments_by_category:
                comments_by_category[category] = {"high": 0, "medium": 0, "low": 0, "critical": 0}

            if severity in comments_by_category[category]:
                comments_by_category[category][severity] += 1

        # Add summary of findings by category
        summary_body += f"- I found {num_suggestions} potential areas for discussion/improvement (see my review comments above or in the review tab).\n"
        summary_body += f"- {review_file_url_md}.\n\n"

        summary_body += "### Summary of My Findings by Category:\n"
        for category, severities in sorted(comments_by_category.items()):
            total = sum(severities.values())
            if total == 0:
                continue

            # Format severity counts
            severity_parts = []
            if severities.get("critical", 0) > 0:
                severity_parts.append(f"**{severities['critical']} critical**")
            if severities.get("high", 0) > 0:
                severity_parts.append(f"**{severities['high']} high**")
            if severities.get("medium", 0) > 0:
                severity_parts.append(f"{severities['medium']} medium")
            if severities.get("low", 0) > 0:
                severity_parts.append(f"{severities['low']} low")

            severity_text = ", ".join(severity_parts)
            summary_body += f"- **{category}**: {total} issues ({severity_text})\n"
    else:
        summary_body += "- I didn't find any specific issues in this code review pass.\n"

    # Add review information
    summary_body += f"\n### About My Review\n"
    summary_body += f"- I used model: `{os.environ.get('GEMINI_MODEL', 'N/A')}`\n"

    # Add API key information if key rotation occurred
    api_key_info = "primary"
    rate_limit_warning = ""
    fallback_key_note = ""

    if gemini_key_manager:
        if gemini_key_manager.current_key_name == "GEMINI_FALLBACK_API_KEY":
            api_key_info = "fallback (rotated due to rate limiting)"
        
        # Add note about fallback key usage if applicable
        if gemini_key_manager.used_fallback_key:
            fallback_key_note = "- **Note:** I encountered rate limiting with the primary API key, but I was able to use the fallback key successfully.\n"

        # Add warning only if ALL keys were rate limited and got no results
        if gemini_key_manager.all_keys_rate_limited and num_suggestions == 0:
            rate_limit_warning = "\n\n⚠️ **Warning: I encountered rate limiting with ALL my API keys during this review.** My review may be incomplete or missing suggestions due to API quota limitations."

    summary_body += f"- API key used: {api_key_info}\n"
    summary_body += fallback_key_note
    summary_body += f"- My review focused on: Logic flaws, runtime behavior issues, and code quality\n"
    summary_body += f"- To mark my comments as resolved: Add `[ADDRESSED]` to the comment in the JSON file, followed by `**Resolution**: your explanation`\n"

    # Add rate limit warning if applicable
    summary_body += rate_limit_warning

    # Add workflow run log link if available
    run_id = os.environ.get('GITHUB_RUN_ID')
    repo_name = os.environ.get('GITHUB_REPOSITORY')
    if run_id and repo_name:
        # Use a direct link to the run instead of trying to link to the specific job
        # This is more reliable as the job ID format in URLs is numeric and not available directly
        run_log_url = f"https://github.com/{repo_name}/actions/runs/{run_id}"
        summary_body += f"- [View workflow run log]({run_log_url})\n"

    # Post the summary comment
    try:
        if target_obj:
            if review_context.event_type == "pull_request" or review_context.event_type == "issue_comment":
                try:
                    target_obj.create_issue_comment(summary_body)
                    logger.info("Successfully created summary comment on PR/Issue.")
                except GithubException as e:
                    logger.error("Error creating summary comment on PR/Issue: %s (Status: %s, Data: %s)", e, getattr(e, 'status', 'N/A'), getattr(e, 'data', 'N/A'), exc_info=True)
                except Exception as e:
                    logger.error("Unexpected error creating summary comment on PR/Issue: %s", e, exc_info=True)
                    traceback.print_exc()
            elif review_context.event_type == "push":
                logger.warning("Summary comments are not directly supported for bare commits via create_issue_comment. Skipping summary comment.")
                # The review results are still saved to the JSON file.
        else:
            logger.error("Cannot post summary comment: No valid target object (PR or Commit) available.")
    except Exception as e:
        logger.error("Unhandled error during summary comment posting: %s", e, exc_info=True)
        traceback.print_exc()


def parse_diff_to_patchset(diff_text: str) -> Optional[PatchSet]:
    if not diff_text:
        print("No diff text to parse.")
        return None
    try:
        patch_set = PatchSet(diff_text)
        print(f"Diff parsed into PatchSet with {len(list(patch_set))} patched files.")
        return patch_set
    except Exception as e:
        print(f"Error parsing diff string with unidiff: {type(e).__name__} - {e}")
        print(f"Diff text that failed (first 1000 chars): {diff_text[:1000]}")
    return None


def main():
    """
    Main function to run the AI code review process.

    This function handles the entire workflow:
    1. Get PR details
    2. Determine what to review based on event type
    3. Get the diff
    4. Parse the diff
    5. Filter files to analyze
    6. Analyze the code
    7. Save review results
    8. Create review and summary comments

    Proper exception handling is implemented throughout to ensure the script
    doesn't terminate abruptly and provides useful error messages.
    """
    logger.info("Starting AI Code Review Script...")

    # Validate that clients are available
    if not gh or not gemini_client_module:
        logger.error("GitHub or Gemini client not available. Exiting.")
        raise ValueError("GitHub or Gemini client not available")

    try:
        # Get review context
        review_context = get_review_context()
        logger.info(f"Processing event of type: {review_context.event_type} in repo {review_context.get_full_repo_name()}")

        diff_text = ""
        comparison_sha_for_diff = None
        head_sha = None
        base_sha = None
        
        if review_context.event_type == "pull_request":
            head_sha = review_context.pr_obj.head.sha if review_context.pr_obj and review_context.pr_obj.head else None
            base_sha = review_context.pr_obj.base.sha if review_context.pr_obj and review_context.pr_obj.base else None
            
            last_run_sha_from_env = os.environ.get("LAST_RUN_SHA", "").strip()

            if review_context.event_type in ["opened", "reopened"]:
                comparison_sha_for_diff = base_sha
                logger.info(f"Event type is '{review_context.event_type}'. Reviewing full PR against base SHA: {comparison_sha_for_diff}")
            elif review_context.event_type == "synchronize":
                if last_run_sha_from_env and last_run_sha_from_env != head_sha:
                    comparison_sha_for_diff = last_run_sha_from_env
                    logger.info(f"Event type is 'synchronize'. Reviewing changes since last run SHA: {comparison_sha_for_diff}")
                else:
                    comparison_sha_for_diff = base_sha
                    if not last_run_sha_from_env:
                        logger.info(f"Event type is 'synchronize', but no last_run_sha found. Reviewing full PR against base SHA: {comparison_sha_for_diff}")
                    elif last_run_sha_from_env == head_sha:
                        logger.info(f"Event type is 'synchronize', but last_run_sha ({last_run_sha_from_env}) is same as head_sha. No new commits for incremental review. Defaulting to full review against base SHA: {comparison_sha_for_diff}.")
            else:
                comparison_sha_for_diff = base_sha
                logger.info(f"Event type is '{review_context.event_type}'. Defaulting to full review against base SHA: {comparison_sha_for_diff}")

            if head_sha == comparison_sha_for_diff:
                logger.info(f"HEAD SHA ({head_sha}) is the same as comparison SHA ({comparison_sha_for_diff}). No new changes to diff.")
                save_review_results_to_json(review_context, [], "reviews/gemini-pr-review.json")
                create_review_and_summary_comment(review_context, [], "reviews/gemini-pr-review.json")
                logger.info("Exiting as there are no new changes to review based on SHAs.")
                return

            diff_text = get_diff(review_context, comparison_sha_for_diff)

        elif review_context.event_type == "push":
            head_sha = review_context.commit_sha
            commit_review_filepath = "reviews/gemini-commit-review.json"
            last_reviewed_commit_sha = None

            # Attempt to load last reviewed commit SHA from the review file
            previous_commit_review_data = load_previous_review_data(filepath_str=commit_review_filepath)
            if previous_commit_review_data and "metadata" in previous_commit_review_data and \
               "commit_sha" in previous_commit_review_data["metadata"]:
                last_reviewed_commit_sha = previous_commit_review_data["metadata"]["commit_sha"]
                logger.info(f"Last reviewed commit SHA from {commit_review_filepath}: {last_reviewed_commit_sha}")

            if last_reviewed_commit_sha and last_reviewed_commit_sha != head_sha:
                comparison_sha_for_diff = last_reviewed_commit_sha
                logger.info(f"Event type is 'push'. Reviewing new commits from {last_reviewed_commit_sha} to {head_sha}.")
                diff_text = get_diff(review_context, comparison_sha_for_diff)
            elif review_context.commit_obj and review_context.commit_obj.parents:
                comparison_sha_for_diff = review_context.commit_obj.parents[0].sha
                logger.info(f"Event type is 'push'. No previous commit SHA or same as head. Reviewing commit {head_sha} against parent {comparison_sha_for_diff}.")
                diff_text = get_diff(review_context, comparison_sha_for_diff)
            else:
                logger.warning(f"Push event for commit {head_sha} has no parent and no previous commit SHA to compare against. No diff to review.")
                save_review_results_to_json(review_context, [], commit_review_filepath)
                create_review_and_summary_comment(review_context, [], commit_review_filepath)
                return

            # If diff_text is still empty after trying all comparisons, exit
            if not diff_text:
                logger.warning("No diff content retrieved for push event. Exiting review process.")
                save_review_results_to_json(review_context, [], commit_review_filepath)
                create_review_and_summary_comment(review_context, [], commit_review_filepath)
                return

        elif review_context.event_type == "issue_comment":
            # For issue_comment events, we assume it's on a PR and re-review the PR
            if review_context.pr_obj:
                head_sha = review_context.pr_obj.head.sha
                base_sha = review_context.pr_obj.base.sha
                comparison_sha_for_diff = base_sha # Always review full PR on issue_comment
                logger.info(f"Event type is 'issue_comment' on PR #{review_context.pull_number}. Re-reviewing full PR against base SHA: {comparison_sha_for_diff}")
                diff_text = get_diff(review_context, comparison_sha_for_diff)
            else:
                logger.warning("Issue comment event not linked to a PR. No diff to review.")
                return
        
        if not diff_text:
            logger.warning("No diff content retrieved. Exiting review process.")
            review_file_path = "reviews/gemini-pr-review.json" if review_context.event_type == "pull_request" else "reviews/gemini-commit-review.json"
            save_review_results_to_json(review_context, [], review_file_path)
            create_review_and_summary_comment(review_context, [], review_file_path)
            return

        # Parse the diff
        initial_patch_set = parse_diff_to_patchset(diff_text)
        if not initial_patch_set:
            logger.error("Failed to parse diff into PatchSet. Exiting.")
            review_file_path = "reviews/gemini-pr-review.json" if review_context.event_type == "pull_request" else "reviews/gemini-commit-review.json"
            save_review_results_to_json(review_context, [], review_file_path)
            raise ValueError("Failed to parse diff into PatchSet")

        # Filter files to analyze
        exclude_patterns_str = os.environ.get("INPUT_EXCLUDE", "")
        exclude_patterns = [p.strip() for p in exclude_patterns_str.split(',') if p.strip()]

        actual_files_to_process: List[PatchedFile] = []
        for patched_file_obj in initial_patch_set:
            normalized_path = patched_file_obj.path.lstrip('./')
            is_excluded = False

            if patched_file_obj.is_removed_file or (patched_file_obj.is_added_file and patched_file_obj.target_file == '/dev/null'):
                logger.info(f"Skipping removed file (or added as /dev/null): {patched_file_obj.path}")
                is_excluded = True
            elif patched_file_obj.is_binary_file:
                logger.info(f"Excluding binary file: {patched_file_obj.path}")
                is_excluded = True
            else:
                for pattern in exclude_patterns:
                    if fnmatch.fnmatch(normalized_path, pattern) or fnmatch.fnmatch(patched_file_obj.path, pattern):
                        logger.info(f"Excluding file '{patched_file_obj.path}' due to pattern '{pattern}'.")
                        is_excluded = True
                        break
            if not is_excluded:
                actual_files_to_process.append(patched_file_obj)

        num_files_to_analyze = len(actual_files_to_process)
        logger.info(f"Number of files to analyze after exclusions: {num_files_to_analyze}")

        if num_files_to_analyze == 0:
            logger.warning("No files to analyze after applying exclusion patterns.")
            review_file_path = "reviews/gemini-pr-review.json" if review_context.event_type == "pull_request" else "reviews/gemini-commit-review.json"
            save_review_results_to_json(review_context, [], review_file_path)
            create_review_and_summary_comment(review_context, [], review_file_path)
            return

        # Analyze the code
        comments_for_gh_review_api = analyze_code(actual_files_to_process, review_context)

        # Save review results and create comments
        review_json_filepath = "reviews/gemini-pr-review.json" if review_context.event_type == "pull_request" else "reviews/gemini-commit-review.json"
        save_review_results_to_json(review_context, comments_for_gh_review_api, review_json_filepath)
        create_review_and_summary_comment(review_context, comments_for_gh_review_api, review_json_filepath)

        logger.info("AI Code Review Script finished successfully.")
    except ValueError as e:
        # Expected errors that we've explicitly raised
        logger.error("Error in main process: %s", e, exc_info=True)
        # We don't re-raise here as we want to handle these gracefully
    except Exception as e:
        # Unexpected errors
        logger.error("Unexpected error in main process: %s", e, exc_info=True)
        traceback.print_exc()
        # We don't re-raise here to avoid abrupt termination


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        # Let system exit exceptions propagate
        raise
    except Exception as e:
        # Catch any unhandled exceptions that weren't caught in main()
        logger.critical("Unhandled exception in __main__: %s - %s", type(e).__name__, e, exc_info=True)
        traceback.print_exc()

        # Create an empty review file to avoid workflow failures
        try:
            # Get review context if possible
            try:
                review_context = get_review_context()
                review_file_path = "reviews/gemini-pr-review.json" if review_context.event_type == "pull_request" else "reviews/gemini-commit-review.json"
                save_review_results_to_json(review_context, [], review_file_path)
            except Exception:
                # If we can't get review context, create a minimal review file
                os.makedirs("reviews", exist_ok=True)
                with open("reviews/gemini-pr-review.json", "w") as f: # Default to PR review file
                    json.dump({"metadata": {"error": str(e)}, "review_comments": []}, f)
        except Exception as file_error:
            logger.critical("Failed to create empty review file: %s", file_error, exc_info=True)

        # Exit with error code
        sys.exit(1)

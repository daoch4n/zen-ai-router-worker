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

# Add these imports for parallelism
import concurrent.futures
import threading

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
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(threadName)s - %(message)s') # Added threadName
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
            logger.error(f"Error generating JWT token: {e}")
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
            logger.error(f"Error getting installation access token: {e}")
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
                        logger.error(f"Error getting installation access token: {e}")
                        logger.info("Falling back to GITHUB_TOKEN due to installation token error")
            except Exception as e:
                logger.error(f"Error during JWT token generation: {e}")
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

# Modified GeminiKeyManager for thread-safety
class GeminiKeyManager:
    def __init__(self):
        self.primary_key = os.environ.get("GEMINI_API_KEY")
        self.fallback_key = os.environ.get("GEMINI_FALLBACK_API_KEY")
        if not self.primary_key:
            logger.error("GEMINI_API_KEY environment variable is required")
            raise ValueError("GEMINI_API_KEY environment variable is required")
        self.current_key = self.primary_key
        self.current_key_name = "GEMINI_API_KEY"
        self.rate_limited_keys = set()
        self.encountered_rate_limiting = False
        self.all_keys_rate_limited = False
        self.used_fallback_key = False
        self.rotation_order = ["GEMINI_API_KEY"]
        if self.fallback_key:
            self.rotation_order.append("GEMINI_FALLBACK_API_KEY")
            logger.info("Fallback API key is available for rotation.")
        else:
            logger.warning("No GEMINI_FALLBACK_API_KEY found. API key rotation will not be available.")
        logger.info(f"Initialized GeminiKeyManager with primary key and {'a fallback key' if self.fallback_key else 'no fallback key'}")
        self._lock = threading.Lock() # Lock for thread-safe modifications

    def get_current_key(self):
        with self._lock: # Ensure consistent read if needed, though current_key is mostly read
            return self.current_key

    def get_current_key_name(self):
        with self._lock: # Ensure consistent read
            return self.current_key_name

    def get_key_by_name(self, key_name):
        if key_name == "GEMINI_API_KEY":
            return self.primary_key
        elif key_name == "GEMINI_FALLBACK_API_KEY":
            return self.fallback_key
        return None

    def rotate_key(self):
        with self._lock:
            logger.info(f"Attempting to rotate key. Current: {self.current_key_name}. Rate limited keys: {self.rate_limited_keys}")
            self.rate_limited_keys.add(self.current_key_name)
            self.encountered_rate_limiting = True
            if self.fallback_key and "GEMINI_FALLBACK_API_KEY" not in self.rate_limited_keys:
                logger.info(f"Rotating from {self.current_key_name} to GEMINI_FALLBACK_API_KEY due to rate limiting")
                self.current_key = self.fallback_key
                self.current_key_name = "GEMINI_FALLBACK_API_KEY"
                self.used_fallback_key = True
                return True
            else:
                logger.warning("All available API keys are rate limited or unavailable. Resetting to primary key if primary was also rate-limited.")
                if self.current_key_name != "GEMINI_API_KEY" or "GEMINI_API_KEY" in self.rate_limited_keys :
                    self.current_key = self.primary_key
                    self.current_key_name = "GEMINI_API_KEY"
                    if len(self.rate_limited_keys) >= len(self.rotation_order):
                         logger.info("All keys have been tried and rate limited in this cycle. Clearing rate_limited_keys to try again.")
                         self.rate_limited_keys.clear()

                self.all_keys_rate_limited = True
                return False


    def is_rate_limit_error(self, error):
        error_str = str(error).lower()
        is_rate_limit = (
            "429" in error_str or
            "quota" in error_str or
            "rate limit" in error_str or
            "resourceexhausted" in error_str
        )
        if is_rate_limit:
            with self._lock: # Protect modification of encountered_rate_limiting
                self.encountered_rate_limiting = True
        return is_rate_limit

# Global instance of the key manager
gemini_key_manager = None

def initialize_gemini_client():
    global gemini_key_manager
    if os.environ.get("GEMINI_TEST_MODE") == "1":
        logger.info("Test mode: Skipping Gemini client initialization")
        return None
    gemini_key_manager = GeminiKeyManager()
    Client.configure(api_key=gemini_key_manager.get_current_key())
    return Client

# Initialize clients (as before)
try:
    authenticator = GitHubAuthenticator()
    gh, github_token = authenticator.authenticate()
    gemini_client_module = initialize_gemini_client()
    logger.info("Successfully initialized GitHub and Gemini clients")
except ValueError as e:
    logger.error(f"Initialization error: {str(e)}")
    sys.exit(1)
except Exception as e:
    logger.error(f"Unexpected error during initialization: {str(e)}")
    traceback.print_exc()
    sys.exit(1)

class PRDetails:
    def __init__(self, owner: str, repo_name_str: str, pull_number: int, title: Optional[str], description: Optional[str], repo_obj=None, pr_obj=None, event_type: Optional[str] = None):
        self.owner = owner
        self.repo_name = repo_name_str
        self.pull_number = pull_number
        self.title = title
        self.description = description
        self.repo_obj = repo_obj
        self.pr_obj = pr_obj
        self.event_type = event_type

    def get_full_repo_name(self):
        return f"{self.owner}/{self.repo_name}"


def get_pr_details() -> PRDetails:
    github_event_path = os.environ.get("GITHUB_EVENT_PATH")
    if not github_event_path:
        logger.error("Error: GITHUB_EVENT_PATH environment variable not set.")
        sys.exit(1)

    with open(github_event_path, "r", encoding="utf-8") as f:
        event_data = json.load(f)

    event_name = os.environ.get("GITHUB_EVENT_NAME")
    pr_event_type = None

    if event_name == "issue_comment":
        if "issue" in event_data and "pull_request" in event_data["issue"]:
            pull_number = event_data["issue"]["number"]
            repo_full_name = event_data["repository"]["full_name"]
            pr_event_type = "comment"
        else:
            logger.error("Error: issue_comment event not on a pull request.")
            sys.exit(1)
    elif event_name == "pull_request":
        pull_number = event_data["pull_request"]["number"]
        repo_full_name = event_data["repository"]["full_name"]
        pr_event_type = event_data.get("action")
        logger.info(f"Pull request event action: {pr_event_type}")
    else:
        logger.error(f"Error: Unsupported GITHUB_EVENT_NAME: {event_name}")
        sys.exit(1)

    owner, repo_name_str = repo_full_name.split("/")

    try:
        repo_obj = gh.get_repo(repo_full_name) if gh else None
        pr_obj = repo_obj.get_pull(pull_number) if repo_obj else None
    except GithubException as e:
        logger.error(f"Error accessing GitHub repository or PR: {e}")
        sys.exit(1)
    except Exception as e:
        logger.error(f"An unexpected error occurred while fetching PR details: {e}")
        sys.exit(1)
    
    pr_title = pr_obj.title if pr_obj else ""
    pr_body = pr_obj.body if pr_obj else ""
    return PRDetails(owner, repo_name_str, pull_number, pr_title, pr_body, repo_obj, pr_obj, pr_event_type)


def get_diff(pr_details: PRDetails, comparison_sha: Optional[str] = None) -> str:
    repo = pr_details.repo_obj
    pr = pr_details.pr_obj
    head_sha = pr.head.sha if pr and pr.head else None

    if comparison_sha:
        logger.info(f"Getting diff comparing HEAD ({head_sha}) against specified SHA ({comparison_sha})")
        try:
            comparison_obj = repo.compare(comparison_sha, head_sha) if repo and head_sha else None
            diff_parts = []
            if comparison_obj and comparison_obj.files:
                for file_diff in comparison_obj.files:
                    if file_diff.patch:
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
                            diff_header += f"rename from {source_file_path_for_header}\n"
                            diff_header += f"rename to {target_file_path_for_header}\n"
                            if hasattr(file_diff, 'sha'):
                                 diff_header += f"index {getattr(file_diff, 'previous_sha', '0000000')[:7]}..{file_diff.sha[:7]}\n"
                        
                        patch_content = file_diff.patch
                        lines = patch_content.splitlines()
                        final_patch_lines = []
                        final_patch_lines.append(f"--- a/{source_file_path_for_header}")
                        final_patch_lines.append(f"+++ b/{target_file_path_for_header}")
                        final_patch_lines.extend(lines)
                        diff_parts.append(diff_header + "\n".join(final_patch_lines))
            if diff_parts:
                diff_text = "\n".join(diff_parts)
                logger.info(f"Retrieved diff (length: {len(diff_text)}) using repo.compare('{comparison_sha}', '{head_sha}')")
                return diff_text
            else:
                logger.info(f"No changes found comparing {comparison_sha} to {head_sha}")
                return ""
        except GithubException as e:
            logger.warning(f"Error getting comparison diff (compare {comparison_sha} vs {head_sha}): {e}. Falling back.")
        except Exception as e:
            logger.error(f"Unexpected error during repo.compare: {e}. Falling back.")
            traceback.print_exc()

    logger.info(f"Falling back to pr.get_diff() for PR #{pr_details.pull_number}")
    try:
        diff_text = pr.get_diff() if pr else None
        if diff_text:
            logger.info(f"Retrieved diff (length: {len(diff_text)}) using pr.get_diff()")
            return diff_text
        else:
            logger.warning("pr.get_diff() returned no content.")
            return ""
    except GithubException as e:
        logger.warning(f"Error getting diff using pr.get_diff(): {e}. Falling back further.")
    except Exception as e:
        logger.error(f"Unexpected error during pr.get_diff(): {e}. Falling back further.")

    logger.info(f"Falling back to direct API request for PR diff for PR #{pr_details.pull_number}")
    api_url = f"https://api.github.com/repos/{pr_details.get_full_repo_name()}/pulls/{pr_details.pull_number}"
    headers = {'Accept': 'application/vnd.github.v3.diff'}
    try:
        request_auth = GitHubAuthenticator()
        _, token = request_auth.authenticate()
        if token:
            headers['Authorization'] = f'token {token}'
        else:
            github_env_token = os.environ.get("GITHUB_TOKEN")
            if github_env_token:
                 logger.warning("Using GITHUB_TOKEN directly for API request as App authenticator failed to provide a token")
                 headers['Authorization'] = f'token {github_env_token}'
            else:
                logger.error("No authentication token available for API request")
                return ""
    except Exception as auth_error:
        logger.error(f"Authentication error for direct API request: {auth_error}")
        github_env_token = os.environ.get("GITHUB_TOKEN")
        if github_env_token:
            logger.warning("Using GITHUB_TOKEN directly for API request after authentication error")
            headers['Authorization'] = f'token {github_env_token}'
        else:
                logger.error("No authentication token available for API request")
                return ""
    try:
        response = requests.get(api_url, headers=headers, timeout=30)
        response.raise_for_status()
        diff_text = response.text
        logger.info(f"Retrieved diff (length: {len(diff_text)}) via direct API call.")
        return diff_text
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to get diff via direct API call: {e}")
    except Exception as e:
        logger.error(f"Unexpected error during direct API call for diff: {e}")

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
        logger.info(f"Skipping full file context for non-code or binary-like file: {file_path}")
        return ""
    try:
        p_file_path = Path(file_path)
        if p_file_path.exists() and p_file_path.is_file():
            file_stat = p_file_path.stat()
            max_initial_read_bytes = 300000
            if file_stat.st_size > max_initial_read_bytes:
                logger.info(f"File {file_path} is very large ({file_stat.st_size} bytes). Reading a truncated version for context.")
                with open(p_file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    start_content = f.read(max_initial_read_bytes // 2)
                full_file_content = start_content + "\n\n... [content truncated due to very large size] ...\n\n"
            else:
                with open(p_file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    full_file_content = f.read()

            max_char_len_for_context = 150000
            if len(full_file_content) > max_char_len_for_context:
                logger.info(f"File content for {file_path} still too long after initial read ({len(full_file_content)} chars), further truncating for Gemini context.")
                half_len = max_char_len_for_context // 2
                full_file_content = full_file_content[:half_len] + \
                                    "\n\n... [content context truncated for brevity] ...\n\n" + \
                                    full_file_content[-half_len:]
            logger.info(f"Read file content for {file_path} (length: {len(full_file_content)} chars after potential truncation).")
        else:
            logger.warning(f"File {file_path} does not exist locally or is not a file. Cannot provide full context.")
    except Exception as e:
        logger.error(f"Error reading full file content for {file_path}: {e}")
        traceback.print_exc()
    return full_file_content

def load_previous_review_data(filepath_str: str = "reviews/gemini-pr-review.json") -> Dict[str, Any]:
    filepath = Path(filepath_str)
    if not filepath.exists():
        logger.info(f"Previous review file {filepath_str} not found. No previous context will be provided.")
        return {}
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
            logger.info(f"Successfully loaded previous review data from {filepath_str}")
            return data
    except Exception as e:
        logger.error(f"Error loading previous review data from {filepath_str}: {e}")
        return {}


def get_previous_file_comments(review_data: Dict[str, Any], file_path: str) -> List[Dict[str, Any]]:
    if not review_data or "review_comments" not in review_data:
        return []
    file_comments = []
    for comment in review_data.get("review_comments", []):
        comment_text = comment.get("comment_text_md", "")
        if comment.get("file_path") == file_path and "[IGNORED]" not in comment_text:
            file_comments.append(comment)
    logger.info(f"Found {len(file_comments)} previous comments for file {file_path}")
    return file_comments


def create_batch_prompt(patched_file: PatchedFile, pr_details: PRDetails) -> str:
    full_file_content_for_context = get_file_content(patched_file.path)
    previous_review_data = load_previous_review_data()
    previous_file_comments = get_previous_file_comments(previous_review_data, patched_file.path)

    combined_hunks_text = ""
    for i, hunk in enumerate(patched_file):
        hunk_text = get_hunk_representation(hunk)
        if not hunk_text.strip():
            continue
        separator = ("-" * 20) + f" Hunk {i+1} (0-indexed: {i}) " + ("-" * 20) + "\n"
        combined_hunks_text += ("\n\n" if i > 0 else "") + separator + hunk_text
    
    instructions = """Your task is reviewing pull requests. You will provide structured output in JSON format.
 
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
      "hunkIndex": 0,
      "lineNumber": 1,
      "reviewComment": "Your review comment in GitHub Markdown format",
      "confidence": "High"
    }
  ]
}
 
IMPORTANT NOTES ABOUT LINE NUMBERS:
- The hunkIndex must be a valid 0-based index within the range of hunks in the diff
- The lineNumber must be a valid 1-based line number within the content of the specified hunk
- If you're unsure about the exact line number, choose the first line of the relevant code block
- Do not specify line numbers outside the range of the hunk content
"""
    pr_context = f"\nPull Request Title: {pr_details.title}\nPull Request Description:\n---\n{pr_details.description or 'No description provided.'}\n---\n"
    previous_review_context = ""
    if previous_file_comments:
        previous_review_context = "\n## My Previous Review Comments for this file:\n"
        for i, comment in enumerate(previous_file_comments):
            comment_text = comment.get('comment_text_md', 'N/A')
            is_addressed = "[ADDRESSED]" in comment_text
            status_marker = "✅ ADDRESSED" if is_addressed else "⏳ PENDING"
            previous_review_context += f"### Comment {i+1}: {status_marker}\n"
            previous_review_context += f"- **File**: {comment.get('file_path')}\n"
            previous_review_context += f"- **Category**: {comment.get('detected_category_heuristic', 'N/A')}\n"
            previous_review_context += f"- **Severity**: {comment.get('detected_severity_heuristic', 'N/A')}\n"
            previous_review_context += f"- **Content**: {comment_text}\n\n"
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
    return instructions + pr_context + previous_review_context + file_context_header + file_content_block + diff_to_review_header + diff_block


# --- Rate Limiting Logic with Locks ---
LAST_GEMINI_REQUEST_TIME = 0
GEMINI_RPM_LIMIT = int(os.environ.get("GEMINI_RPM_LIMIT", 45))
GEMINI_REQUEST_INTERVAL_SECONDS = 60.0 / GEMINI_RPM_LIMIT
gemini_rate_limit_lock = threading.Lock() # Lock for time-based rate limiter
gemini_api_interaction_lock = threading.Lock() # Lock for Client.configure and generate_content

def enforce_gemini_rate_limits():
    global LAST_GEMINI_REQUEST_TIME
    with gemini_rate_limit_lock: # Protects LAST_GEMINI_REQUEST_TIME
        current_time = time.time()
        time_since_last = current_time - LAST_GEMINI_REQUEST_TIME
        if time_since_last < GEMINI_REQUEST_INTERVAL_SECONDS:
            wait_time = GEMINI_REQUEST_INTERVAL_SECONDS - time_since_last
            logger.info(f"Gemini Rate Limiter: Waiting {wait_time:.2f} seconds.")
            time.sleep(wait_time)
        LAST_GEMINI_REQUEST_TIME = time.time()


def process_structured_output(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not isinstance(data, dict) or "reviews" not in data or not isinstance(data["reviews"], list):
        logger.error(f"Error: Structured output has invalid structure. Expected {{'reviews': [...]}}. Got: {type(data)}")
        return []
    valid_reviews = []
    for i, review_item in enumerate(data["reviews"]):
        if not isinstance(review_item, dict):
            logger.error(f"Error: Review item {i} is not a dict: {review_item}")
            continue
        required_keys = ["hunkIndex", "lineNumber", "reviewComment", "confidence"]
        if not all(k in review_item for k in required_keys):
            logger.error(f"Error: Review item {i} missing one or more required keys ({', '.join(required_keys)}): {review_item}")
            continue
        try:
            if not isinstance(review_item["hunkIndex"], int):
                review_item["hunkIndex"] = int(review_item["hunkIndex"])
            if not isinstance(review_item["lineNumber"], int):
                review_item["lineNumber"] = int(review_item["lineNumber"])
        except (ValueError, TypeError) as e:
            logger.error(f"Error: Review item {i} hunkIndex or lineNumber not convertible to int: {review_item}, error: {e}")
            continue
        if review_item["confidence"] not in ["High", "Medium", "Low"]:
            logger.warning(f"Warning: Review item {i} has invalid confidence '{review_item.get('confidence')}'. Defaulting to Low.")
            review_item["confidence"] = "Low"
        valid_reviews.append(review_item)
    logger.info(f"Successfully processed {len(valid_reviews)} valid review items from structured output.")
    return valid_reviews

def improved_calculate_github_position(file_patch: PatchedFile, hunk_idx: int, line_num_in_hunk: int) -> Optional[int]:
    try:
        hunks_in_file = list(file_patch)
        if not (0 <= hunk_idx < len(hunks_in_file)):
            logger.warning(f"Warning: Invalid hunk index {hunk_idx} for file {file_patch.path} (has {len(hunks_in_file)} hunks)")
            return None
        target_hunk = hunks_in_file[hunk_idx]
        hunk_lines = list(target_hunk)
        num_lines_in_hunk = len(hunk_lines)
        if not (1 <= line_num_in_hunk <= num_lines_in_hunk):
            logger.warning(f"Warning: Line number {line_num_in_hunk} is outside the range of hunk content (1-{num_lines_in_hunk}) for hunk index {hunk_idx}")
            return None
        
        position = 0
        for i in range(hunk_idx):
            position += 1
            position += len(list(hunks_in_file[i]))
        position += 1
        position += line_num_in_hunk -1
        
        return position
    except Exception as e:
        logger.error(f"Error calculating GitHub position: {e}")
        traceback.print_exc()
        return None


def get_ai_response_with_structured_output(prompt: str, model_name: str, max_retries: int = 3) -> List[Dict[str, Any]]:
    global gemini_key_manager

    if not gemini_client_module or not gemini_key_manager:
        logger.error("Error: Gemini client or key manager not initialized. Cannot make API call.")
        return []

    review_item_schema = {"type": "object", "properties": {"hunkIndex": {"type": "integer"}, "lineNumber": {"type": "integer"}, "reviewComment": {"type": "string"}, "confidence": {"type": "string", "enum": ["High", "Medium", "Low"]}}, "required": ["hunkIndex", "lineNumber", "reviewComment", "confidence"]}
    response_schema = {"type": "object", "properties": {"reviews": {"type": "array", "items": review_item_schema}}, "required": ["reviews"]}
    logger.info(f"Full prompt (length {len(prompt)}). Start:\n{prompt[:500]}...\n...End:\n{prompt[-500:]}")

    for attempt in range(1, max_retries + 1):
        api_key_to_use = gemini_key_manager.get_current_key()
        key_name_to_use = gemini_key_manager.get_current_key_name()
        
        with gemini_api_interaction_lock:
            try:
                Client.configure(api_key=api_key_to_use)
                gemini_model = gemini_client_module.GenerativeModel(
                    model_name,
                    generation_config={"max_output_tokens": 8192, "temperature": 0.4, "top_p": 0.95, "top_k": 40, "response_mime_type": "application/json", "response_schema": response_schema},
                    safety_settings=[{"category": f"HARM_CATEGORY_{harm.upper()}", "threshold": "BLOCK_MEDIUM_AND_ABOVE"} for harm in ["harassment", "hate_speech", "sexually_explicit", "dangerous_content"]]
                )
                
                enforce_gemini_rate_limits()
                
                key_prefix = api_key_to_use[:5] if api_key_to_use else "None"
                logger.info(f"Attempt {attempt}/{max_retries} - Sending prompt to Gemini model {model_name} using key: {key_name_to_use} ({key_prefix}***)")
                response = gemini_model.generate_content(prompt)

                if not response.parts:
                    logger.warning(f"AI response (attempt {attempt}) was empty or blocked.")
                    if attempt < max_retries: time.sleep((2 ** attempt) * 2); continue
                    return []

                data_to_process = None
                if hasattr(response, 'candidates') and response.candidates and hasattr(response.candidates[0], 'content') and hasattr(response.candidates[0].content, 'parts'):
                    part = response.candidates[0].content.parts[0]
                    if hasattr(part, 'function_call') and part.function_call and hasattr(part.function_call, 'args'):
                        logger.info("Received structured output response with function_call.args.")
                        data_to_process = part.function_call.args
                    elif hasattr(part, 'text'):
                         try:
                            data_to_process = json.loads(part.text)
                            logger.info("Parsed JSON from text part of response.")
                         except json.JSONDecodeError:
                            logger.error(f"Failed to parse JSON from text part: {part.text[:200]}")
                            data_to_process = None
                
                if data_to_process:
                    return process_structured_output(data_to_process)

                logger.info("Structured output via function_call.args not found or failed. Checking response.text or parsed.")
                if hasattr(response, 'text') and response.text:
                    try:
                        response_text = response.text.strip()
                        if response_text.startswith("```json"): response_text = response_text[len("```json"):]
                        if response_text.endswith("```"): response_text = response_text[:-len("```")]
                        data = json.loads(response_text.strip())
                        return process_structured_output(data)
                    except json.JSONDecodeError as e:
                        logger.error(f"Error decoding JSON from AI response.text (attempt {attempt}): {e}. Response text: {response.text[:200]}")
                        if attempt < max_retries: time.sleep(2 ** attempt); continue
                        return []
                elif hasattr(response, 'parsed_message'):
                     logger.info("Trying response.parsed_message for structured output")
                     return process_structured_output(response.parsed_message)


                logger.warning(f"AI response (attempt {attempt}) could not be processed into structured data.")
                if attempt < max_retries: time.sleep((2 ** attempt) * 2); continue
                return []

            except Exception as e:
                logger.error(f"Error during Gemini API call (attempt {attempt}) using key {key_name_to_use}: {type(e).__name__} - {e}")
                if gemini_key_manager.is_rate_limit_error(e):
                    logger.info(f"Detected rate limit error with key {key_name_to_use}.")
                    if gemini_key_manager.rotate_key():
                        new_key_name = gemini_key_manager.get_current_key_name()
                        logger.info(f"Rotated to alternative API key {new_key_name}. Retrying current attempt with new key.")
                    else:
                        logger.warning("All API keys are rate limited or unavailable. Will retry after delay if attempts remain.")
                        if attempt < max_retries: time.sleep(15 * attempt);
                        else: return []
                
                if attempt < max_retries:
                    time.sleep(5 * attempt)
                else:
                    return []
    return []

def get_ai_response_with_retry(prompt: str, max_retries: int = 3) -> List[Dict[str, Any]]:
    model_name = os.environ.get('GEMINI_MODEL', 'gemini-1.5-flash-latest')
    if not gemini_client_module:
        logger.error("Error: Gemini client module not initialized. Cannot make API call.")
        return []
    return get_ai_response_with_structured_output(prompt, model_name, max_retries)


# --- Task for ThreadPoolExecutor ---
def _analyze_file_task(patched_file: PatchedFile, pr_details: PRDetails) -> List[Dict[str, Any]]:
    thread_name = threading.current_thread().name
    logger.info(f"Starting analysis for file: {patched_file.path} in {thread_name}")
    try:
        if not patched_file.path or patched_file.path == "/dev/null":
            logger.info(f"Skipping file with invalid path: {patched_file.path} in {thread_name}")
            return []
        hunks_in_file = list(patched_file)
        if not hunks_in_file:
            logger.info(f"No hunks in file {patched_file.path}, skipping in {thread_name}.")
            return []

        logger.info(f"Processing file: {patched_file.path} with {len(hunks_in_file)} hunks in {thread_name}.")
        batch_prompt = create_batch_prompt(patched_file, pr_details)
        ai_reviews_for_file = get_ai_response_with_retry(batch_prompt)

        if ai_reviews_for_file:
            logger.info(f"Received {len(ai_reviews_for_file)} review suggestions from AI for file {patched_file.path} in {thread_name}.")
            file_comments = process_batch_ai_reviews(patched_file, ai_reviews_for_file)
            return file_comments
        else:
            logger.info(f"No review suggestions from AI for file {patched_file.path} in {thread_name}.")
            return []
    except Exception as e:
        logger.error(f"Error analyzing file {patched_file.path} in {thread_name}: {e}")
        traceback.print_exc()
        return []


def analyze_code(files_to_review: Iterable[PatchedFile], pr_details: PRDetails) -> List[Dict[str, Any]]:
    files_list = list(files_to_review)
    logger.info(f"Starting code analysis for {len(files_list)} files using parallel processing.")
    all_comments_for_pr = []

    try:
        max_workers_str = os.environ.get("MAX_PARALLEL_FILE_REVIEWS", "2") # Default to 2 as per instructions
        max_workers = int(max_workers_str)
        if max_workers <= 0:
            logger.warning(f"MAX_PARALLEL_FILE_REVIEWS was '{max_workers_str}', defaulting to 1 (sequential).")
            max_workers = 1
    except ValueError:
        logger.warning(f"Invalid MAX_PARALLEL_FILE_REVIEWS value, defaulting to 2.") # Default to 2
        max_workers = 2
    
    logger.info(f"Using up to {max_workers} parallel workers for file analysis.")

    if max_workers == 1:
        logger.info("Running in sequential mode (max_workers=1).")
        for patched_file in files_list:
            comments = _analyze_file_task(patched_file, pr_details)
            if comments:
                all_comments_for_pr.extend(comments)
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="ReviewWorker") as executor:
            future_to_file = {executor.submit(_analyze_file_task, patched_file, pr_details): patched_file for patched_file in files_list}
            for future in concurrent.futures.as_completed(future_to_file):
                patched_file = future_to_file[future]
                try:
                    file_comments_result = future.result()
                    if file_comments_result:
                        all_comments_for_pr.extend(file_comments_result)
                    logger.info(f"Completed analysis for file: {patched_file.path}")
                except Exception as exc:
                    logger.error(f"File {patched_file.path} generated an exception during parallel processing: {exc}")
                    traceback.print_exc()

    logger.info(f"Finished analysis. Total comments generated for PR: {len(all_comments_for_pr)}")
    return all_comments_for_pr

def get_hunk_header_str(hunk: Hunk) -> str:
    return f"@@ -{hunk.source_start},{hunk.source_length} +{hunk.target_start},{hunk.target_length} @@"

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
                logger.warning(f"AI returned out-of-bounds hunkIndex {hunk_idx_from_ai} for file {patched_file.path} "
                               f"(has {len(hunks_in_file)} hunks). Skipping comment.")
                continue
            
            github_pos_result = improved_calculate_github_position(patched_file, hunk_idx_from_ai, line_num_in_hunk_content)
            
            formatted_comment_body = f"**My Confidence: {confidence}**\n\n{comment_text}"
            gh_comment_data = {
                "body": formatted_comment_body,
                "path": patched_file.path,
                "confidence_raw": confidence
            }

            if github_pos_result is None:
                logger.warning(f"Could not calculate GitHub position for comment in {patched_file.path}, Hunk Index {hunk_idx_from_ai}, Line {line_num_in_hunk_content}. Posting as file-level comment.")
                gh_comment_data["position"] = 1
                gh_comment_data["invalidPosition"] = True
                gh_comment_data["body"] = ("**Note: I couldn't precisely position this comment in the diff (targeting Hunk Index "
                                          f"{hunk_idx_from_ai}, Line {line_num_in_hunk_content}), "
                                          "but I think it's important feedback:**\n\n" + formatted_comment_body)
            else:
                gh_comment_data["position"] = github_pos_result
            
            comments_for_github.append(gh_comment_data)

        except KeyError as e:
            logger.error(f"Error processing AI review item due to missing key {e}: {review_detail}")
        except Exception as e:
            logger.error(f"Unexpected error processing AI review item {review_detail}: {e}")
            traceback.print_exc()
    return comments_for_github

def save_review_results_to_json(pr_details: PRDetails, comments: List[Dict[str, Any]], filepath_str: str = "reviews/gemini-pr-review.json") -> str:
    filepath = Path(filepath_str)
    filepath.parent.mkdir(parents=True, exist_ok=True)
    api_key_info = "primary"
    rate_limited = False
    if gemini_key_manager:
        if gemini_key_manager.used_fallback_key :
            api_key_info = "fallback (rotated due to rate limiting at some point)"
        elif gemini_key_manager.encountered_rate_limiting and not gemini_key_manager.used_fallback_key and not gemini_key_manager.fallback_key:
            api_key_info = "primary (encountered rate limiting, no fallback available)"
        elif gemini_key_manager.encountered_rate_limiting and not gemini_key_manager.used_fallback_key and gemini_key_manager.fallback_key:
             api_key_info = "primary (encountered rate limiting, fallback available but not used/needed or also limited)"

        rate_limited = gemini_key_manager.all_keys_rate_limited

    review_data = {
        "metadata": {
            "pr_number": pr_details.pull_number, "repo": pr_details.get_full_repo_name(), "title": pr_details.title,
            "timestamp_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "review_tool": "I'm your Gemini AI Reviewer", "model_used": os.environ.get('GEMINI_MODEL', 'N/A'),
            "api_key_used_status": api_key_info, "all_keys_rate_limited_during_review": rate_limited
        },
        "review_comments": []
    }
    for gh_comment_dict in comments:
        structured_comment = {
            "file_path": gh_comment_dict["path"], "github_diff_position": gh_comment_dict["position"],
            "comment_text_md": gh_comment_dict["body"], "ai_confidence": gh_comment_dict.get("confidence_raw", "N/A"),
            "detected_severity_heuristic": detect_severity(gh_comment_dict["body"]),
            "detected_category_heuristic": detect_category(gh_comment_dict["body"])
        }
        if gh_comment_dict.get("invalidPosition"):
            structured_comment["invalidPosition"] = True
        review_data["review_comments"].append(structured_comment)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(review_data, f, indent=2)
    logger.info(f"Review results saved to {filepath}")
    return str(filepath)


def detect_severity(comment_text: str) -> str:
    lower_text = comment_text.lower()
    confidence = "medium"
    if "**my confidence: high**" in lower_text: confidence = "high"
    elif "**my confidence: low**" in lower_text: confidence = "low"

    if any(w in lower_text for w in ["critical", "security vulnerability", "crash", "exploit", "must fix", "data loss", "deadlock", "race condition", "memory leak", "infinite loop"]): return "critical"
    if any(w in lower_text for w in ["bug", "error", "incorrect", "wrong", "security", "potential vulnerability", "flaw", "exception", "broken", "incorrect behavior", "inconsistent behavior"]): return "high"
    if any(w in lower_text for w in ["performance", "optimization", "memory", "leak", "consider fixing", "confusing", "unclear", "inefficient", "redundant", "duplicate"]):
        return "high" if confidence == "high" else "medium"
    if any(w in lower_text for w in ["style", "formatting", "naming", "convention", "documentation", "comment", "clarity", "suggestion", "consider", "might", "could"]):
        return "medium" if confidence == "high" else "low"
    if confidence == "high": return "medium"
    elif confidence == "medium": return "low"
    return "low"

def detect_category(comment_text: str) -> str:
    lower_text = comment_text.lower()
    if any(w in lower_text for w in ["security", "vulnerability", "exploit", "auth", "csrf", "xss", "injection", "password", "secret", "encryption", "authentication"]): return "security"
    if any(w in lower_text for w in ["race condition", "deadlock", "concurrency", "thread safety", "synchronization", "atomic", "lock", "mutex", "semaphore"]): return "concurrency"
    if any(w in lower_text for w in ["bug", "error", "incorrect", "wrong", "fix", "defect", "exception", "nullpointer", "undefined", "crash", "broken", "inconsistent behavior"]): return "bug"
    if any(w in lower_text for w in ["memory leak", "resource leak", "file handle", "connection", "not closed", "not released", "not disposed"]): return "resource-management"
    if any(w in lower_text for w in ["performance", "slow", "optimization", "efficient", "memory", "cpu", "latency", "resource", "bottleneck", "timeout", "delay"]): return "performance"
    if any(w in lower_text for w in ["error handling", "exception handling", "try/catch", "recovery", "fallback", "resilience", "robustness"]): return "error-handling"
    if any(w in lower_text for w in ["refactor", "clean", "simplify", "maintainability", "design", "architecture", "pattern", "anti-pattern", "duplication", "redundant", "duplicate"]): return "refactoring/design"
    if any(w in lower_text for w in ["state management", "state machine", "lifecycle", "initialization", "cleanup", "side effect"]): return "state-management"
    if any(w in lower_text for w in ["test", "coverage", "assertion", "mocking", "unit test", "integration test", "e2e test"]): return "testing"
    if any(w in lower_text for w in ["style", "format", "naming", "convention", "readability", "clarity", "understandability", "documentation", "commenting"]): return "style/clarity"
    return "general"

def create_review_and_summary_comment(pr_details: PRDetails, comments_for_gh_review: List[Dict[str, Any]], review_json_path: str):
    if not pr_details.pr_obj:
        logger.error("PR object not available in PRDetails. Cannot create review or comments.")
        return

    pr_for_comments = pr_details.pr_obj
    num_suggestions = len(comments_for_gh_review)
    
    if gh and gh != pr_details.pr_obj._requester:
        try:
            bot_repo = gh.get_repo(pr_details.get_full_repo_name())
            pr_for_comments = bot_repo.get_pull(pr_details.pull_number)
            logger.info(f"Using App-authenticated client for creating review comments on PR #{pr_details.pull_number}")
        except Exception as e:
            logger.warning(f"Failed to get PR object with App-authenticated client, falling back. Error: {e}")

    if num_suggestions > 0:
        valid_review_comments = []
        for c in comments_for_gh_review:
            if all(k in c for k in ["body", "path", "position"]) and isinstance(c["position"], int) and isinstance(c["path"], str) and isinstance(c["body"], str):
                valid_review_comments.append({"body": c["body"], "path": c["path"], "position": c["position"]})
            else:
                logger.warning(f"Skipping malformed comment due to type/key mismatch: {c}")
        if valid_review_comments:
            try:
                logger.info(f"Creating a PR review with {len(valid_review_comments)} suggestions.")
                pr_for_comments.create_review(body="I've reviewed your code and have some suggestions:", event="COMMENT", comments=valid_review_comments)
                logger.info("Successfully created PR review with suggestions.")
            except GithubException as e:
                logger.error(f"Error creating PR review: {e}. Status: {e.status}, Data: {e.data}")
                logger.warning("Falling back to posting individual issue comments for suggestions.")
                for c_item in valid_review_comments:
                    try: pr_for_comments.create_issue_comment(f"I found an issue in **File:** `{c_item['path']}` (at diff position {c_item['position']})\n\n{c_item['body']}")
                    except Exception as ie: logger.error(f"Error posting individual suggestion as issue comment: {ie}")
            except Exception as e:
                logger.error(f"Unexpected error during PR review creation: {e}")
                traceback.print_exc()
        else: logger.warning("No validly structured comments to create a review with.")
    else: logger.info("No suggestions to create a PR review for.")

    repo_full_name = os.environ.get("GITHUB_REPOSITORY", pr_details.get_full_repo_name())
    server_url = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
    branch_name = os.environ.get("GITHUB_HEAD_REF", pr_details.pr_obj.head.ref if pr_details.pr_obj and pr_details.pr_obj.head else None)
    review_file_url_md = f"Review JSON file (`{review_json_path}` in the repository)"
    if branch_name:
        try:
            encoded_branch = urllib.parse.quote_plus(branch_name)
            review_file_url = f"{server_url}/{repo_full_name}/blob/{encoded_branch}/{review_json_path}"
            review_file_url_md = f"Full review details in [`{review_json_path}`]({review_file_url})"
        except Exception as url_e: logger.error(f"Error creating review file URL: {url_e}")
    else: logger.warning("Could not determine branch name for summary comment URL.")

    summary_body = f"✨ **I've completed my code review!** ✨\n\n"
    if num_suggestions > 0:
        comments_by_category = {}
        for c in comments_for_gh_review:
            if "body" not in c: continue
            category, severity = detect_category(c["body"]), detect_severity(c["body"])
            if category not in comments_by_category: comments_by_category[category] = {"high": 0, "medium": 0, "low": 0, "critical": 0}
            if severity in comments_by_category[category]: comments_by_category[category][severity] += 1
        summary_body += f"- I found {num_suggestions} potential areas for discussion/improvement.\n"
        summary_body += f"- {review_file_url_md}.\n\n### Summary of My Findings by Category:\n"
        for category, severities in sorted(comments_by_category.items()):
            total = sum(severities.values())
            if total == 0: continue
            severity_parts = [f"**{s_count} {s_sev}**" for s_sev, s_count in severities.items() if s_count > 0 and s_sev in ["critical", "high"]]
            severity_parts.extend([f"{s_count} {s_sev}" for s_sev, s_count in severities.items() if s_count > 0 and s_sev not in ["critical", "high"]])
            summary_body += f"- **{category}**: {total} issues ({', '.join(severity_parts)})\n"
    else: summary_body += "- I didn't find any specific issues in this code review pass.\n"

    summary_body += f"\n### About My Review\n- Model: `{os.environ.get('GEMINI_MODEL', 'N/A')}`\n"
    api_key_status_msg = "primary key"
    fallback_note = ""
    rate_limit_warning_msg = ""

    if gemini_key_manager:
        if gemini_key_manager.used_fallback_key:
            api_key_status_msg = "fallback key (primary was rate-limited)"
            fallback_note = "- **Note:** I used a fallback API key as the primary was rate-limited.\n"
        elif gemini_key_manager.encountered_rate_limiting:
            api_key_status_msg = "primary key (encountered rate-limiting)"
        
        if gemini_key_manager.all_keys_rate_limited and num_suggestions == 0 :
             rate_limit_warning_msg = "\n\n⚠️ **Warning: I encountered rate limiting with ALL my API keys.** My review might be incomplete."


    summary_body += f"- API key status: {api_key_status_msg}\n{fallback_note}"
    summary_body += f"- Focused on: Logic flaws, runtime behavior, code quality\n"
    summary_body += f"- To mark comments as resolved: Add `[ADDRESSED]` to the comment in `{review_json_path}`, followed by `**Resolution**: your explanation`\n"
    summary_body += rate_limit_warning_msg
    
    run_id, repo_name_env = os.environ.get('GITHUB_RUN_ID'), os.environ.get('GITHUB_REPOSITORY')
    if run_id and repo_name_env:
        summary_body += f"- [View workflow run log](https://github.com/{repo_name_env}/actions/runs/{run_id})\n"
    try:
        pr_for_comments.create_issue_comment(summary_body)
        logger.info("Successfully created summary comment on PR.")
    except GithubException as e: logger.error(f"Error creating summary PR comment: {e}")
    except Exception as e: logger.error(f"Unexpected error creating summary PR comment: {e}"); traceback.print_exc()


def parse_diff_to_patchset(diff_text: str) -> Optional[PatchSet]:
    if not diff_text:
        logger.info("No diff text to parse.")
        return None
    try:
        patch_set = PatchSet(diff_text)
        logger.info(f"Diff parsed into PatchSet with {len(list(patch_set))} patched files.")
        return patch_set
    except Exception as e:
        logger.error(f"Error parsing diff string with unidiff: {type(e).__name__} - {e}")
        logger.debug(f"Diff text that failed (first 1000 chars): {diff_text[:1000]}")
    return None

def main():
    logger.info("Starting AI Code Review Script...")
    if not gh or not gemini_client_module:
        logger.error("GitHub or Gemini client not available. Exiting.")
        raise ValueError("GitHub or Gemini client not available")

    try:
        pr_details = get_pr_details()
        logger.info(f"Processing PR #{pr_details.pull_number} in repo {pr_details.get_full_repo_name()} (Event: {pr_details.event_type})")

        last_run_sha_from_env = os.environ.get("LAST_RUN_SHA", "").strip()
        head_sha = pr_details.pr_obj.head.sha if pr_details.pr_obj and pr_details.pr_obj.head else None
        base_sha = pr_details.pr_obj.base.sha if pr_details.pr_obj and pr_details.pr_obj.base else None
        comparison_sha_for_diff = base_sha

        if pr_details.event_type in ["opened", "reopened"]:
            logger.info(f"Event '{pr_details.event_type}'. Reviewing full PR against base SHA: {base_sha}")
            comparison_sha_for_diff = base_sha
        elif pr_details.event_type == "synchronize":
            if last_run_sha_from_env and last_run_sha_from_env != head_sha:
                comparison_sha_for_diff = last_run_sha_from_env
                logger.info(f"Event 'synchronize'. Reviewing changes since last run SHA: {comparison_sha_for_diff} against HEAD {head_sha}")
            else:
                logger.info(f"Event 'synchronize', but no suitable last_run_sha. Reviewing full PR against base SHA: {base_sha}")
                comparison_sha_for_diff = base_sha
        else:
            logger.info(f"Event '{pr_details.event_type}'. Defaulting to full review against base SHA: {base_sha}")
            comparison_sha_for_diff = base_sha
        
        if not head_sha or not comparison_sha_for_diff:
            logger.error(f"Cannot determine SHAs for diff (HEAD: {head_sha}, Base/Comparison: {comparison_sha_for_diff}). Exiting.")
            save_review_results_to_json(pr_details, [], "reviews/gemini-pr-review.json")
            create_review_and_summary_comment(pr_details, [], "reviews/gemini-pr-review.json")
            return

        if head_sha == comparison_sha_for_diff:
            logger.info(f"HEAD SHA ({head_sha}) is same as comparison SHA ({comparison_sha_for_diff}). No new changes to diff.")
            save_review_results_to_json(pr_details, [], "reviews/gemini-pr-review.json")
            create_review_and_summary_comment(pr_details, [], "reviews/gemini-pr-review.json")
            return

        diff_text = get_diff(pr_details, comparison_sha_for_diff)
        if not diff_text:
            logger.warning("No diff content retrieved. Exiting review process.")
            save_review_results_to_json(pr_details, [], "reviews/gemini-pr-review.json")
            create_review_and_summary_comment(pr_details, [], "reviews/gemini-pr-review.json")
            return

        initial_patch_set = parse_diff_to_patchset(diff_text)
        if not initial_patch_set:
            logger.error("Failed to parse diff into PatchSet. Exiting.")
            save_review_results_to_json(pr_details, [], "reviews/gemini-pr-review.json")
            return

        exclude_patterns_str = os.environ.get("INPUT_EXCLUDE", "")
        exclude_patterns = [p.strip() for p in exclude_patterns_str.split(',') if p.strip()]
        actual_files_to_process: List[PatchedFile] = []
        for pf_obj in initial_patch_set:
            normalized_path = pf_obj.path.lstrip('./') if pf_obj.path else ""
            is_excluded = False
            if pf_obj.is_removed_file or (pf_obj.is_added_file and pf_obj.target_file == '/dev/null') or pf_obj.is_binary_file:
                logger.info(f"Skipping binary, removed, or /dev/null file: {pf_obj.path}")
                is_excluded = True
            else:
                for pattern in exclude_patterns:
                    if fnmatch.fnmatch(normalized_path, pattern) or fnmatch.fnmatch(pf_obj.path, pattern):
                        logger.info(f"Excluding file '{pf_obj.path}' due to pattern '{pattern}'.")
                        is_excluded = True; break
            if not is_excluded: actual_files_to_process.append(pf_obj)
        
        logger.info(f"Number of files to analyze after exclusions: {len(actual_files_to_process)}")
        if not actual_files_to_process:
            logger.warning("No files to analyze after applying exclusion patterns.")
            save_review_results_to_json(pr_details, [], "reviews/gemini-pr-review.json")
            create_review_and_summary_comment(pr_details, [], "reviews/gemini-pr-review.json")
            return
        
        comments_for_gh_review_api = analyze_code(actual_files_to_process, pr_details)
        review_json_filepath = "reviews/gemini-pr-review.json"
        save_review_results_to_json(pr_details, comments_for_gh_review_api, review_json_filepath)
        create_review_and_summary_comment(pr_details, comments_for_gh_review_api, review_json_filepath)
        logger.info("AI Code Review Script finished successfully.")

    except ValueError as e: logger.error(f"Error in main process: {str(e)}")
    except Exception as e: logger.error(f"Unexpected error in main process: {str(e)}"); traceback.print_exc()


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        logger.critical(f"Unhandled exception in __main__: {type(e).__name__} - {e}")
        traceback.print_exc()
        try:
            error_pr_details = None
            try: error_pr_details = get_pr_details()
            except: pass

            if error_pr_details:
                save_review_results_to_json(error_pr_details, [], "reviews/gemini-pr-review.json")
            else:
                os.makedirs("reviews", exist_ok=True)
                with open("reviews/gemini-pr-review.json", "w") as f:
                    json.dump({"metadata": {"error": f"Unhandled exception: {str(e)}"}, "review_comments": []}, f)
        except Exception as file_error:
            logger.critical(f"Failed to create empty/error review file: {file_error}")
        sys.exit(1)

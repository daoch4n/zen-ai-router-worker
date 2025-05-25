### Product Requirements Document: TypeScript to JavaScript Refactoring

**Document Version:** 1.0
**Date:** 2025-05-25
**Author:** AI Architect

---

### 1. Introduction

This document outlines the plan to refactor the entire project from TypeScript (.ts files) to pure JavaScript (.mjs files). The goal is to standardize the codebase on JavaScript for Cloudflare Workers, eliminating the need for TypeScript compilation and related configurations. This will streamline the development process and reduce build complexity.

---

### 2. Scope

The refactoring effort will encompass all TypeScript-related aspects of the project, ensuring a complete transition to pure JavaScript.

#### 2.1 Files to Convert
*   `orchestrator/src/index.ts`: Convert this primary orchestrator worker entry point to `orchestrator/src/index.mjs`.

#### 2.2 Configuration Files to Remove/Update
*   `tsconfig.json`: This file, central to TypeScript configuration, will be removed as TypeScript will no longer be used in the project.
*   `orchestrator/wrangler.toml`: The `main` entry point for the orchestrator worker will be updated from pointing to a `.ts` file to `orchestrator/src/index.mjs`.
*   `package.json`:
    *   Review and remove `typescript` from `devDependencies`.
    *   Update or remove any `scripts` (e.g., `build`, `lint`) that specifically invoke `tsc` or other TypeScript-related tools.
    *   Ensure `"type": "module"` is explicitly set to ensure all JavaScript files are treated as ES Modules.
*   `jest.config.mjs`: This Jest configuration file will be reviewed and updated to remove any TypeScript-specific transformers or presets (e.g., `ts-jest`) to ensure compatibility with pure JavaScript testing.
*   `.github/workflows/cf-deploy.yml`: The GitHub Actions workflow for deployment will be reviewed and modified to remove any build steps that involve TypeScript compilation. The deployment process should directly utilize the `.mjs` files.

#### 2.3 Code Refactoring
*   **Type Annotations**: All explicit type annotations (e.g., `: string`, `: MyInterface<T>`) will be systematically removed from the code.
*   **Interfaces and Types**: `interface` and `type` declarations will be removed. If these definitions were used for runtime validation or documentation, they will be either replaced with runtime checks (e.g., using Joi or similar validation libraries) or converted to JSDoc comments for documentation purposes, depending on their critical runtime necessity.
*   **Enums**: TypeScript `enum` declarations will be converted to plain JavaScript objects with `const` declarations or simple constant variables, maintaining their functional equivalent.
*   **Import/Export Statements**:
    *   All `import` and `export` statements referencing local files will be updated to explicitly use the `.mjs` extension (e.g., `import { func } from './module.mjs';`).
    *   `import type { ... } from '...';` statements, which are TypeScript-specific, will be removed.
    *   The entire codebase will strictly adhere to ES module syntax (`import`/`export`).

---

### 3. Technical Approach

The conversion will follow a systematic and iterative approach to minimize disruption and ensure correctness.

#### 3.1 Identification Phase
1.  **Identify TypeScript Files**: A command like `find . -name "*.ts"` will be used to confirm all `.ts` files in the project. Based on current environment details, the primary file is `orchestrator/src/index.ts`.
2.  **Identify Relevant Configuration Files**: Confirm the presence and content of `tsconfig.json`, `orchestrator/wrangler.toml`, `package.json`, `jest.config.mjs`, and `.github/workflows/cf-deploy.yml` to understand their current TypeScript dependencies.

#### 3.2 Conversion Steps

1.  **Rename TypeScript Files**:
    *   Rename `orchestrator/src/index.ts` to `orchestrator/src/index.mjs`.
2.  **Refactor TypeScript Syntax to JavaScript**:
    *   Open `orchestrator/src/index.mjs` and systematically remove all TypeScript-specific syntax:
        *   Remove type annotations from function parameters, return types, and variable declarations.
        *   Convert `interface` and `type` declarations. For example, if an interface defines a shape for an object, consider documenting it with JSDoc `@typedef` for maintainability without static typing.
        *   Convert `enum` declarations to plain JavaScript objects.
    *   **Example Transformation**:
        ```mermaid
        graph TD
            A[TypeScript Code] --> B{Remove Type Annotations};
            B --> C{Convert Interfaces/Types};
            C --> D{Convert Enums};
            D --> E[Pure JavaScript Code];

            subgraph Type Conversion Examples
                TS_Interface[interface MyType { prop: string; }] --> JS_JSDoc[/** @typedef {{prop: string}} MyType */];
                TS_Enum[enum Status { Active, Inactive }] --> JS_Object[const Status = { Active: 'Active', Inactive: 'Inactive' }];
            end
        ```
3.  **Update Import/Export Paths**:
    *   Perform a project-wide search and replace to change `.ts` extensions to `.mjs` in `import` and `export` statements. This will affect imports within `orchestrator/src/index.mjs` and any other `.mjs` files that previously imported from `orchestrator/src/index.ts`.
    *   Remove any `import type` statements.
4.  **Update `wrangler.toml` files**:
    *   Modify `orchestrator/wrangler.toml` to update the `main` entry point:
        ```toml
        # Before
        # main = "src/index.ts"
        # After
        main = "src/index.mjs"
        ```
5.  **Update `package.json`**:
    *   Remove `"typescript"` from the `devDependencies` section.
    *   Remove or modify `scripts` entries that specifically call `tsc` or other TypeScript tools (e.g., `"build": "tsc"`, `"lint": "eslint . --ext .ts"`).
    *   Confirm or add `"type": "module"` at the top level of `package.json` to enforce ES Module behavior.
6.  **Remove `tsconfig.json`**: Delete the `tsconfig.json` file from the project root.
7.  **Update `jest.config.mjs`**: Review and update `jest.config.mjs`. If it includes `preset: 'ts-jest'` or similar, replace it with a standard JavaScript configuration or remove the preset entirely if not needed.
8.  **Update GitHub Actions Workflow**:
    *   Edit `.github/workflows/cf-deploy.yml` to remove steps related to TypeScript compilation (e.g., `npm run build` if it involves `tsc`). The deployment should now directly publish the `.mjs` files.

---

### 4. Testing Strategy

Comprehensive testing will be performed at multiple stages to verify the successful refactoring and ensure no regressions are introduced.

1.  **Local Development Server Verification**:
    *   Start both the orchestrator and backend Cloudflare Workers locally using `flatpak-spawn --host wrangler dev`.
    *   Manually test all critical API endpoints exposed by both workers to ensure they function as expected and return correct responses.
2.  **Unit Test Execution**:
    *   Execute the existing unit test suite using `flatpak-spawn --host npm test`.
    *   Verify that all tests pass without errors or failures. Any tests that relied on TypeScript-specific constructs or import paths will be updated to reflect the `.mjs` changes.
3.  **Integration Test (If Applicable)**:
    *   If the project includes integration tests that verify interactions between the orchestrator and backend workers, these tests will be executed to confirm end-to-end functionality.
4.  **Staging Deployment & Functional Testing**:
    *   Deploy the refactored workers to a non-production staging environment using `flatpak-spawn --host wrangler deploy`.
    *   Conduct a final round of functional testing in the deployed staging environment to confirm stability and correctness in a production-like setting.

---

### 5. Rollback Plan

In the event of critical issues or unexpected failures during or after the refactoring process, a clear rollback strategy will be employed to revert the changes.

1.  **Dedicated Git Branch**: All refactoring changes will be committed to a new, dedicated Git branch. This isolation ensures that the main branch remains untouched and stable.
2.  **Version Control Revert**: If a rollback is necessary, the entire feature branch can be easily reverted to the last stable commit before the refactoring started. This can be achieved using standard Git commands such as `flatpak-spawn --host git revert <commit-hash>` or `flatpak-spawn --host git reset --hard <commit-hash-before-refactoring>`.
3.  **Repository Backup**: It is recommended to ensure a fresh backup of the project repository is available before initiating this significant refactoring effort.

---

### 6. Dependencies

The refactoring primarily impacts internal project structure and build processes.

*   **Internal Dependencies**:
    *   **Cloudflare Workers Runtime**: The core functionality relies on the Cloudflare Workers environment's compatibility with pure ES Modules, which is well-supported.
    *   **Existing `.mjs` Files**: Files already in `src/` (e.g., `src/worker.mjs`, `src/handlers/completions.mjs`) that interact with or are imported by the converted `orchestrator/src/index.mjs` must have their import/export paths correctly updated.
    *   **`package.json` Dependencies**: Development and runtime dependencies listed in `package.json` (e.g., `jest`, `wrangler`) must be compatible with a pure JavaScript ES Module environment.
*   **External Dependencies**:
    *   No new external dependencies are anticipated to be introduced. The focus is on ensuring existing external libraries and tools (like `wrangler`) continue to function correctly with the `.mjs` file structure.
    *   **Cloudflare `wrangler` CLI**: Its configuration and deployment capabilities must be compatible with the `.mjs` entry points and the removal of TypeScript build steps.
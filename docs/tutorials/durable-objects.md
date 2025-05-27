

# **Leveraging SQLite-Backed Durable Objects on Cloudflare's Free Plan: A Guide to new_sqlite_classes Migration and Error 10097 Resolution**


## **I. Executive Summary**

Cloudflare Durable Objects offer powerful capabilities for building stateful applications on the serverless edge. However, users on the Cloudflare Free plan may encounter error code 10097 when attempting to create Durable Object namespaces. This error specifically indicates an attempt to configure Durable Objects with a storage backend not supported by the Free plan. The resolution lies in correctly utilizing the new_sqlite_classes migration within the wrangler.toml configuration file. This is because the Free plan exclusively supports Durable Objects backed by SQLite. Adopting SQLite-backed Durable Objects not only resolves this error but also unlocks enhanced features such as relational data modeling and Point-in-Time Recovery, aligning with Cloudflare's recommendation for all new Durable Object implementations. This report provides a comprehensive guide to understanding this requirement, configuring SQLite-backed Durable Objects, and troubleshooting related issues.


## **II. Introduction: Understanding Cloudflare Durable Objects and Error 10097**


### **A. What are Durable Objects?**

Cloudflare Durable Objects are a unique component of the Workers platform, designed to provide strongly consistent, low-latency, stateful coordination at the edge. Unlike traditional stateless serverless functions, a Durable Object instance has persistent storage and a single-threaded execution model, ensuring that operations on its state are serialized and free from race conditions. Each Durable Object is addressable by a unique ID and can be instantiated close to the users interacting with it, minimizing latency. They are particularly well-suited for applications requiring coordination between multiple clients, such as chat applications, collaborative editing tools, game session management, shopping carts, or implementing features like rate limiters and per-user databases.


### **B. Cloudflare Error Code 10097**

Error code 10097, in the context of Durable Objects and the Cloudflare Free plan, carries a very specific meaning. As indicated by user experiences and platform behavior, this error arises when an attempt is made to deploy Durable Objects without correctly specifying the SQLite storage backend, which is the only type of Durable Object storage backend available on the Free plan. A typical manifestation of this error message during deployment is: "In order to use Durable Objects with a free plan, you must create a namespace using a new_sqlite_classes migration. [code: 10097]". This message serves as a crucial diagnostic clue, directly pointing to a misconfiguration related to the storage backend choice for the Durable Object class on the Free plan. While error code 10097 might appear in other contexts with different sub-codes or messages, its association with the new_sqlite_classes requirement is key for Free plan users. Other common Durable Object errors, such as overload or storage timeouts, are distinct and typically have different error codes or accompanying messages.


### **C. The Role of Storage Backends: Key-Value vs. SQLite**

Durable Objects achieve state persistence through an underlying storage backend. Historically, a key-value (KV) storage interface was the primary mechanism. However, Cloudflare has since introduced and now recommends SQLite as a storage backend for Durable Objects, offering significantly enhanced capabilities.

The key differences between the two are substantial:



* **Data Model:** The KV backend provides a simple key-value store, whereas the SQLite backend offers a full relational SQL database within each Object. This allows for more complex data structures, relationships, and querying.
* **Querying Capabilities:** The KV API is limited to basic get, put, list, and delete operations on keys. The SQLite backend, accessed via ctx.storage.sql, allows for the execution of arbitrary SQL queries, including transactions, joins, and aggregations.
* **Advanced Features:** SQLite-backed Durable Objects provide access to features like Point-in-Time Recovery (PITR), enabling the restoration of an Object's embedded SQLite database (both SQL and key-value data stored within it) to any point in the previous 30 days.<sup>1</sup> This is not available for the KV-backed storage.

Reflecting these advantages, Cloudflare's official recommendation is to use the SQLite storage backend for all new Durable Object classes, irrespective of the plan.<sup>1</sup> The KV-backed storage remains available, primarily for backward compatibility with existing implementations.<sup>1</sup>


## **III. Durable Objects on the Cloudflare Free Plan: Limitations and Requirements**


### **A. Free Plan Storage Backend Restriction**

The fundamental reason users encounter error 10097 when misconfiguring Durable Objects on the Cloudflare Free plan is a critical platform limitation: **the Free plan *only* supports Durable Objects that use the SQLite storage backend**.<sup>1</sup> Attempts to create Durable Objects using the older key-value storage backend (e.g., by using a new_classes migration instead of new_sqlite_classes) will fail on this plan, typically resulting in the aforementioned error. This restriction underscores the importance of correctly specifying the new_sqlite_classes migration in the wrangler.toml file for any Durable Object intended to run under the Free plan. If a user wishes to downgrade from a Workers Paid plan to a Free plan, they must first delete all Durable Object namespaces that utilize the key-value storage backend.<sup>1</sup>


### **B. Key Limitations for SQLite-Backed DOs on the Free Plan**

While SQLite-backed Durable Objects are available on the Free plan, they are subject to certain limitations. Understanding these is crucial for designing applications that operate reliably within these constraints.


<table>
  <tr>
   <td><strong>Feature</strong>
   </td>
   <td><strong>Limit (Free Plan, SQLite-backed DOs)</strong>
   </td>
   <td><strong>Reference(s)</strong>
   </td>
  </tr>
  <tr>
   <td>Maximum Durable Object Classes
   </td>
   <td>100 per account
   </td>
   <td><sup>4</sup>
   </td>
  </tr>
  <tr>
   <td>Storage per Account
   </td>
   <td>5 GB total for all SQLite-backed DOs
   </td>
   <td><sup>4</sup>
   </td>
  </tr>
  <tr>
   <td>Storage per Durable Object
   </td>
   <td>10 GB (for its individual SQLite database)
   </td>
   <td><sup>4</sup>
   </td>
  </tr>
  <tr>
   <td>Storage per Class
   </td>
   <td>Unlimited (within account/object limits)
   </td>
   <td><sup>4</sup>
   </td>
  </tr>
  <tr>
   <td>Key Size (KV API within SQLite DO)
   </td>
   <td>Key and value combined cannot exceed 2 MB
   </td>
   <td><sup>4</sup>
   </td>
  </tr>
  <tr>
   <td>Value Size (KV API within SQLite DO)
   </td>
   <td>Key and value combined cannot exceed 2 MB
   </td>
   <td><sup>4</sup>
   </td>
  </tr>
  <tr>
   <td>Max SQL Statement Length
   </td>
   <td>100 KB
   </td>
   <td><sup>4</sup>
   </td>
  </tr>
  <tr>
   <td>Max Columns per Table
   </td>
   <td>100
   </td>
   <td><sup>4</sup>
   </td>
  </tr>
  <tr>
   <td>CPU per Request
   </td>
   <td>30 seconds (default, resettable per request)
   </td>
   <td><sup>4</sup>
   </td>
  </tr>
</table>


*Note: Storage is measured in gigabytes (1 GB = 1,000,000,000 bytes).<sup>4</sup>*


### **C. Implications of Free Tier Limits**

These limitations have direct implications for application architecture:



* **Storage:** The 5 GB account-wide storage for all SQLite-backed Durable Objects necessitates careful data management and consideration of how many Objects will be created and how much data each will store.<sup>4</sup> While individual Objects can theoretically store up to 10 GB, the account limit is the more practical ceiling for most Free plan users.
* **Compute:** Each incoming HTTP request or WebSocket message to a Durable Object resets its available CPU time (defaulting to 30 seconds). If an Object consumes more than this allowance between network requests, it risks eviction and reset, though persisted state is unaffected.<sup>4</sup> This encourages efficient, short-lived operations within the Object.
* **Number of Classes:** The limit of 100 Durable Object classes per account is generally sufficient for many applications but should be kept in mind for complex systems with many distinct types of stateful entities.<sup>4</sup>

Exceeding these limits can lead to runtime errors or service disruptions, distinct from the initial 10097 setup error.


## **IV. Understanding Durable Object Migrations**


### **A. What are Migrations?**

In the context of Cloudflare Durable Objects, a migration is a formal process that communicates changes to the Workers runtime regarding Durable Object classes. It acts as a mapping from a class name to its runtime state and behavior, particularly concerning its storage and identity.<sup>1</sup> Migrations are essential when:



* Creating a new Durable Object class.
* Renaming an existing Durable Object class.
* Deleting a Durable Object class.
* Transferring an existing Durable Object class (e.g., between different Worker scripts).<sup>1</sup>

Crucially, simply updating the JavaScript/TypeScript code *within* an existing Durable Object class does *not* require a migration. Redeploying the Worker with npx wrangler deploy is sufficient for code changes, even if those changes alter how the Object interacts with its persistent storage.<sup>1</sup> Developers are, however, responsible for ensuring backward compatibility of new code with existing stored data formats.


### **B. The new_sqlite_classes Migration**

The new_sqlite_classes migration is a specific type of "Create migration" used to inform the Cloudflare runtime that one or more newly defined Durable Object classes should be provisioned with an SQLite storage backend.<sup>1</sup> This directive is placed within the [[migrations]] array in the wrangler.toml configuration file.

Its counterpart, new_classes, is used to declare new Durable Object classes that will use the key-value (KV) storage backend.<sup>1</sup> Given the Free plan's restriction to SQLite-backed DOs, new_classes is effectively a paid-plan-only feature. Attempting to use new_classes (or omitting any explicit storage type migration for a new class, which might default to expectations misaligned with free tier capabilities) on a Free plan is a primary cause of the 10097 error.

Migrations, particularly the new_sqlite_classes declaration, are fundamental for defining the *type* of storage backend a Durable Object class will use. This choice is made at the time of class creation through the migration and is immutable for that specific class name; one cannot change an existing KV-backed class to SQLite or vice-versa via a subsequent migration.<sup>1</sup>


### **C. Why new_sqlite_classes is Crucial for Free Plan Users**

The necessity of using the new_sqlite_classes migration for Free plan users stems directly from the platform's constraints:



1. The Cloudflare Free plan exclusively permits Durable Objects that utilize the SQLite storage backend.<sup>1</sup>
2. The new_sqlite_classes migration is the explicit mechanism to instruct the Cloudflare runtime to provision a new Durable Object class with this required SQLite backend.<sup>1</sup>

Failure to include a new_sqlite_classes entry in wrangler.toml for a new Durable Object class when deploying on the Free plan will lead to the runtime being unable to correctly provision the Object, resulting in the 10097 error. This makes the correct migration configuration the non-negotiable first step for using Durable Objects on the Free plan.


## **V. Step-by-Step Guide: Creating a Namespace with new_sqlite_classes**

This section provides a practical walkthrough for configuring and deploying a Durable Object with an SQLite backend on the Cloudflare Free plan, thereby avoiding error 10097.


### **A. Prerequisites**

Before starting, ensure the following are in place:



* A Cloudflare account.
* Node.js and a package manager (npm, yarn, or pnpm) installed on the development machine.
* The Cloudflare Wrangler CLI installed and updated to a recent version. Wrangler is the command-line tool for managing Cloudflare Workers projects. It can be installed or updated via npm/yarn.


### **B. Configuring Durable Object Bindings in wrangler.toml**

The wrangler.toml file is the central configuration file for a Cloudflare Workers project. To use a Durable Object, a binding must be declared. This binding links a name that can be used in the Worker script to access the Durable Object namespace to the actual class name of the Durable Object.

Add the following to the wrangler.toml file:


    Ini, TOML

# wrangler.toml \
 \
[[durable_objects.bindings]] \
name = "MY_DO_STORAGE" # This is how you'll refer to the DO namespace in your Worker code \
class_name = "MyDurableObjectClass" # This must match the exported class name in your DO code \




* name: This is the variable name that will be available on the env object in the Worker code (e.g., env.MY_DO_STORAGE).
* class_name: This must exactly match the name of the exported JavaScript/TypeScript class that defines the Durable Object's logic.<sup>1</sup>


### **C. Adding the new_sqlite_classes Migration in wrangler.toml**

To specify that MyDurableObjectClass should use the SQLite storage backend (essential for the Free plan), a migration entry is required.

Add the following to the wrangler.toml file, typically after the bindings:


    Ini, TOML

# wrangler.toml \
 \
[[migrations]] \
tag = "v1" # A unique tag for this migration set, e.g., "v1", "initial-setup" \
new_sqlite_classes = # Specifies that MyDurableObjectClass uses SQLite \




* tag: A unique string identifier for this set of migration operations. Each migration entry in the migrations array should have a unique tag.<sup>1</sup>
* new_sqlite_classes: An array of strings, where each string is a class_name (as defined in durable_objects.bindings) that should be created with an SQLite backend.<sup>1</sup>


### **D. Complete wrangler.toml Example**

Combining the above, a minimal wrangler.toml for a Worker with one SQLite-backed Durable Object would look like this:


    Ini, TOML

# wrangler.toml \
name = "my-durable-object-worker" # Replace with your Worker's name \
main = "src/index.ts" # Entry point for your Worker code (e.g., src/index.js or src/index.ts) \
compatibility_date = "2024-05-01" # Use a recent date for latest features and behavior \
 \
[[durable_objects.bindings]] \
name = "MY_DO_STORAGE" \
class_name = "MyDurableObjectClass" \
 \
[[migrations]] \
tag = "v1" \
new_sqlite_classes = \


It is critical that the class_name ("MyDurableObjectClass" in this example) is identical in both the [[durable_objects.bindings]] section and the new_sqlite_classes array. Mismatches are a common source of deployment errors.


### **E. Implementing the Durable Object Class (Basic Example)**

The Durable Object itself is implemented as a JavaScript or TypeScript class. This class will handle incoming requests and interact with its private SQLite database via this.ctx.storage.sql.

Here's a basic TypeScript example for src/index.ts:


    TypeScript

// src/index.ts \
 \
// Define the environment bindings expected by the Worker \
export interface Env { \
  MY_DO_STORAGE: DurableObjectNamespace; \
} \
 \
// Define the Durable Object class \
// It must be an exported class and extend DurableObject (or implement the interface if not using class syntax directly) \
export class MyDurableObjectClass implements DurableObject { \
  ctx: DurableObjectState; \
  env: Env; \
 \
  constructor(ctx: DurableObjectState, env: Env) { \
    this.ctx = ctx; \
    this.env = env; \
  } \
 \
  // Helper function to initialize the database schema if it doesn't exist \
  async initializeDB(): Promise&lt;void> { \
    try { \
      await this.ctx.storage.sql.exec(` \
        CREATE TABLE IF NOT EXISTS records ( \
          id INTEGER PRIMARY KEY AUTOINCREMENT, \
          message TEXT, \
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP \
        ) \
      `); \
    } catch (e: any) { \
      console.error(`Failed to initialize database: ${e.message}`); \
      // Depending on the error, you might want to throw it or handle it \
    } \
  } \
 \
  async fetch(request: Request): Promise&lt;Response> { \
    // Ensure the database is initialized. \
    // In a real application, you might do this only once in the constructor \
    // or lazily when first needed, but for simplicity, we call it here. \
    await this.initializeDB(); \
 \
    const url = new URL(request.url); \
 \
    if (url.pathname === "/add") { \
      // Example: Add a new record \
      // In a real app, you'd get data from the request body \
      const text = url.searchParams.get("text") | \
| "Default message"; \
      try { \
        const ps = this.ctx.storage.sql.prepare("INSERT INTO records (message) VALUES (?)"); \
        await ps.bind(text).run(); \
        return new Response(`Record added: ${text}`, { status: 201 }); \
      } catch (e: any) { \
        return new Response(`Failed to add record: ${e.message}`, { status: 500 }); \
      } \
    } else if (url.pathname === "/list") { \
      // Example: List all records \
      try { \
        const ps = this.ctx.storage.sql.prepare("SELECT id, message, timestamp FROM records ORDER BY timestamp DESC"); \
        const { results } = await ps.all(); \
        return new Response(JSON.stringify(results), { \
          headers: { "Content-Type": "application/json" }, \
        }); \
      } catch (e: any) { \
        return new Response(`Failed to list records: ${e.message}`, { status: 500 }); \
      } \
    } \
 \
    // Default response for other paths \
    const { results } = await this.ctx.storage.sql.prepare("SELECT 'Hello from SQLite Durable Object!' AS greeting").all(); \
    const greeting = results && results.length > 0 && (results as any).greeting? (results as any).greeting : "SQLite DO is active"; \
    return new Response(greeting); \
  } \
} \
 \
// Define the Worker's fetch handler \
export default { \
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise&lt;Response> { \
    try { \
      // Create a unique ID for the Durable Object. \
      // For simplicity, this example uses a fixed name, creating a singleton Durable Object. \
      // In a real application, you would derive the name from the request path, a header, \
      // or a query parameter to get or create different instances. \
      const durableObjectName = "my-singleton-instance"; \
      const id: DurableObjectId = env.MY_DO_STORAGE.idFromName(durableObjectName); \
 \
      // Get a stub for the Durable Object. This doesn't create the Object if it doesn't exist yet, \
      // nor does it make a network request. It's a local client-side proxy. \
      // The Object is created on-demand when its `fetch()` method is first called. \
      const stub: DurableObjectStub = env.MY_DO_STORAGE.get(id); \
 \
      // Forward the request to the Durable Object's fetch handler. \
      return await stub.fetch(request); \
    } catch (e: any) { \
      console.error(`Worker fetch error: ${e.message}`); \
      return new Response(`Worker error: ${e.message}`, { status: 500 }); \
    } \
  }, \
} satisfies ExportedHandler&lt;Env>; \


This example demonstrates <sup>5</sup>:



* Importing DurableObject (or ensuring it's globally available depending on project setup).
* Accessing SQLite via this.ctx.storage.sql.
* A basic fetch handler in the Durable Object.
* An initializeDB method to create a table if it doesn't exist.
* A default Worker fetch handler that gets a Durable Object ID (here, using idFromName for a named singleton instance) and forwards the request to the Durable Object stub.


### **F. Deploying Your Worker**

Once the wrangler.toml file is configured and the Durable Object class is implemented, deploy the Worker using Wrangler:


    Bash

npx wrangler deploy \


Or, if Wrangler is installed globally or as a project dependency managed by npm scripts:


    Bash

wrangler deploy \


This command compiles the Worker code, uploads it, and applies any migrations defined in wrangler.toml, including the new_sqlite_classes migration.<sup>1</sup> If successful, the Durable Object namespace will be created with the SQLite backend, and error 10097 should be avoided. The deployment process makes the runtime aware of the new SQLite-backed class structure simultaneously with the code that implements it.


## **VI. Verifying and Troubleshooting**


### **A. Checking for Successful Deployment**

After a successful wrangler deploy command, verify the deployment:



1. **Access the Worker URL:** Send a request to the deployed Worker's URL (e.g., https://my-durable-object-worker.&lt;your-subdomain>.workers.dev). Check if it returns the expected response from the Durable Object.
2. **View Logs with wrangler tail:** Use the wrangler tail command in a separate terminal window to stream live logs from the deployed Worker and its Durable Objects. This is invaluable for debugging and observing behavior. Any console.log statements in the Worker or Durable Object code will appear here.


### **B. Common Pitfalls and Further Troubleshooting (Beyond 10097)**

Even with the new_sqlite_classes migration correctly configured, other issues can arise:



* **Typos and Mismatches:** Ensure the class_name in wrangler.toml (in both [[durable_objects.bindings]] and [[migrations]]) exactly matches the exported class name in the JavaScript/TypeScript code. Case sensitivity matters.
* **Incorrect env Binding Access:** Double-check that the Worker code is correctly accessing the Durable Object namespace via the env object using the name specified in the [[durable_objects.bindings]] (e.g., env.MY_DO_STORAGE).
* **Exceeding Free Tier Limits:** Continuously monitor resource usage.
    * **Storage:** If the 5 GB account storage limit for SQLite DOs is approached, consider optimizing data or upgrading the plan.<sup>4</sup>
    * **CPU:** Long-running operations within a DO request can exceed the CPU time limit (default 30 seconds), causing the Object to be reset. Optimize code for efficiency or break down complex tasks.<sup>4</sup>
    * **Request Rate:** While individual Objects have a soft limit of 1,000 requests per second, very high traffic might lead to issues.
* **Durable Object Overload:** A single instance of a Durable Object can become a bottleneck if it receives too many concurrent requests or if its operations are too slow. This can manifest as "Durable Object is overloaded" errors. Strategies to mitigate this include optimizing per-request work or, for more complex scenarios, sharding requests across multiple Durable Object instances (though this adds complexity).
* **Migration Tag Uniqueness:** Ensure each [[migrations]] block in wrangler.toml has a unique tag value. Reusing tags for different migration definitions can lead to unpredictable behavior.

For general debugging, wrangler dev allows for local testing, though wrangler dev --remote with SQLite Durable Objects might have limitations or require specific configurations regarding SQLite access, as local development environments might not perfectly replicate the Cloudflare edge environment for SQLite features. Always test thoroughly after deployment.


## **VII. Conclusion and Best Practices**

Successfully utilizing Durable Objects on the Cloudflare Free plan hinges on understanding and correctly implementing the new_sqlite_classes migration in the wrangler.toml configuration file. This directive ensures that new Durable Object classes are provisioned with the SQLite storage backend, which is the only backend supported under the Free plan. Adherence to this configuration directly resolves the common deployment error code 10097.

Cloudflare's strong recommendation to use SQLite for all new Durable Objects, even on paid plans, underscores the strategic importance and enhanced capabilities of this storage backend.<sup>1</sup> Features like relational data modeling, SQL querying, and Point-in-Time Recovery offer significant advantages over the older key-value backend.

To ensure robust and scalable applications using Durable Objects, consider the following best practices:



* **Focused Responsibility:** Design Durable Objects to manage state for a single, well-defined entity or resource (e.g., a specific user's session, a particular document, a single game match). This promotes clarity and helps manage the scope of each Object's state.
* **Mind Free Tier Limits:** Be constantly aware of the storage (5 GB per account for SQLite DOs), CPU (30 seconds per request, resettable), and class count (100) limitations on the Free plan. Design data structures and operations efficiently.
* **Idempotency and Error Handling:** Implement robust error handling and consider idempotency for operations that modify state, especially if retries are involved.
* **Efficient Storage Access:** Optimize SQL queries and minimize the amount of data read/written per operation to stay within performance and cost (on paid plans) considerations.
* **Plan for Scalability:** While a single Durable Object is single-threaded, applications can scale by using many Durable Objects. If a single entity's state becomes a bottleneck, advanced techniques like sharding data across multiple coordinated Durable Object instances might be necessary, though this significantly increases application complexity.

By following the guidance in this report and adhering to best practices, developers can effectively leverage the power of SQLite-backed Durable Objects on Cloudflare's Free plan to build sophisticated stateful applications at the edge.


## **VIII. Appendix: Further Reading**

For more detailed information, refer to the official Cloudflare documentation:



* **Durable Objects Overview:** [https://developers.cloudflare.com/durable-objects/](https://developers.cloudflare.com/durable-objects/)
* **Durable Objects Migrations:** [https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
* **Durable Objects Limits:** [https://developers.cloudflare.com/durable-objects/platform/limits/](https://developers.cloudflare.com/durable-objects/platform/limits/)
* **Accessing Durable Objects Storage (including SQLite):** [https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
* **Troubleshooting Durable Objects:** [https://developers.cloudflare.com/durable-objects/observability/troubleshooting/](https://developers.cloudflare.com/durable-objects/observability/troubleshooting/)


#### Works cited



1. Durable Objects migrations · Cloudflare Durable Objects docs, accessed May 28, 2025, [https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
2. SQLite in Durable Objects GA with 10GB storage per object ..., accessed May 28, 2025, [https://developers.cloudflare.com/changelog/2025-04-07-sqlite-in-durable-objects-ga/](https://developers.cloudflare.com/changelog/2025-04-07-sqlite-in-durable-objects-ga/)
3. Troubleshooting · Cloudflare Durable Objects docs, accessed May 28, 2025, [https://developers.cloudflare.com/durable-objects/observability/troubleshooting/](https://developers.cloudflare.com/durable-objects/observability/troubleshooting/)
4. Limits · Cloudflare Durable Objects docs, accessed May 28, 2025, [https://developers.cloudflare.com/durable-objects/platform/limits/](https://developers.cloudflare.com/durable-objects/platform/limits/)
5. Build a seat booking app with SQLite in Durable Objects · Cloudflare ..., accessed May 28, 2025, [https://developers.cloudflare.com/durable-objects/tutorials/build-a-seat-booking-app/](https://developers.cloudflare.com/durable-objects/tutorials/build-a-seat-booking-app/)
6. Building an HTTP SQLite Database with Cloudflare ... - Starbase, accessed May 28, 2025, [https://starbasedb.com/blog/building-an-http-sqlite-database-with-cloudflare-durable-objects/](https://starbasedb.com/blog/building-an-http-sqlite-database-with-cloudflare-durable-objects/)
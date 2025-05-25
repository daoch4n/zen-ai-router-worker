import type { BackendWorkerInterface } from "../../src/interfaces";
interface Service<T> {
  fetch: T;
}

// Define all possible backend service bindings up to the maximum (100)
// This interface allows TypeScript to recognize the dynamically provided bindings.
interface Env {
  BACKEND_SERVICE_1?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_2?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_3?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_4?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_5?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_6?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_7?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_8?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_9?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_10?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_11?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_12?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_13?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_14?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_15?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_16?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_17?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_18?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_19?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_20?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_21?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_22?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_23?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_24?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_25?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_26?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_27?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_28?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_29?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_30?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_31?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_32?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_33?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_34?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_35?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_36?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_37?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_38?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_39?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_40?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_41?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_42?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_43?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_44?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_45?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_46?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_47?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_48?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_49?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_50?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_51?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_52?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_53?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_54?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_55?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_56?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_57?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_58?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_59?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_60?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_61?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_62?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_63?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_64?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_65?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_66?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_67?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_68?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_69?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_70?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_71?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_72?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_73?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_74?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_75?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_76?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_77?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_78?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_79?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_80?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_81?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_82?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_83?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_84?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_85?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_86?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_87?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_88?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_89?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_90?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_91?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_92?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_93?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_94?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_95?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_96?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_97?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_98?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_99?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_100?: Service<BackendWorkerInterface>;
}

let activeBackendServices: Service<BackendWorkerInterface>[] = [];
let nextWorkerIndex = 0;

export default {
  // The `scheduled` handler is a good place for one-time initialization
  // that happens at worker startup.
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Populate activeBackendServices array once at worker startup
    if (activeBackendServices.length === 0) {
      for (let i = 1; i <= 100; i++) {
        const serviceBindingName = `BACKEND_SERVICE_${i}`;
        // Access the service binding dynamically
        const service = env[serviceBindingName as keyof Env];
        if (service) { // If the binding exists (i.e., KEY{i} was present and deployed)
          activeBackendServices.push(service as Service<BackendWorkerInterface>);
        }
      }
      console.log(`Discovered ${activeBackendServices.length} backend workers.`);
    }
  },

  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    // Ensure activeBackendServices is populated. If not, try again (e.g., for local dev or first request)
    if (activeBackendServices.length === 0) {
      // This logic duplicates the scheduled handler for robustness, especially in `wrangler dev`
      for (let i = 1; i <= 100; i++) {
        const serviceBindingName = `BACKEND_SERVICE_${i}`;
        const service = env[serviceBindingName as keyof Env];
        if (service) {
          activeBackendServices.push(service as Service<BackendWorkerInterface>);
        }
      }
      if (activeBackendServices.length === 0) {
        return new Response("No backend workers configured or discovered.", { status: 500 });
      }
    }

    const MAX_ATTEMPTS = activeBackendServices.length; // Max attempts equals number of active workers
    let response: Response | null = null;
    let attempts = 0;

    while (response === null && attempts < MAX_ATTEMPTS) {
        const currentWorkerIndex = (nextWorkerIndex + attempts) % activeBackendServices.length;
        const targetWorker = activeBackendServices[currentWorkerIndex];
        
        try {
            console.log(`Attempting to route to worker index ${currentWorkerIndex}.`);
            response = await targetWorker.handleRequest(request);
        } catch (error) {
            console.error(`Attempt ${attempts + 1} failed for worker at index ${currentWorkerIndex}:`, error);
            attempts++;
            // Optionally: Implement a short delay before retrying
            // await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
    nextWorkerIndex = (nextWorkerIndex + attempts) % activeBackendServices.length; // Update next index for next incoming request

    if (response) {
        return response;
    } else {
        // If all attempts fail
        return new Response("Service Unavailable: All backend workers failed or are unreachable.", { status: 503 });
    }
  }
}
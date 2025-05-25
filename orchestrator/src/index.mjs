
export default {

  async fetch(
    request,
    env,
    ctx
  ) {
    try {
      return await env.BACKEND_SERVICE.fetch(request);
    } catch (error) {
      console.error("Failed to fetch from backend service:", error);
      return new Response("Service Unavailable: Backend worker failed or is unreachable.", { status: 503 });
    }
  }
}
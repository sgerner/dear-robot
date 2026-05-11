/**
 * Gemini API Proxy Worker for Cloudflare
 * 
 * This worker relays requests to the Gemini API (Google Generative AI).
 * Useful for bypassing IP blocks on VPS hosting.
 */

export default {
  async fetch(request, _env, _ctx) {
    const url = new URL(request.url);
    
    // The path should be forwarded as is (e.g. /v1beta/openai/chat/completions)
    // We assume the email agent sends the full path needed by the proxy.
    // If the email agent is configured with the worker URL as baseUrl, 
    // it will append /chat/completions to it.
    
    // Target base URL for Gemini OpenAI-compatible API
    const TARGET_BASE = "https://generativelanguage.googleapis.com";
    
    const targetUrl = new URL(url.pathname + url.search, TARGET_BASE);
    
    // Create a new request with the target URL
    const newRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'follow'
    });

    // Optionally you can log or modify headers here
    
    try {
      const response = await fetch(newRequest);
      
      // Return the response as is
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Proxy Error", message: err.message }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }
  }
};

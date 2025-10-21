export default {
  async fetch(request, env, ctx) {
    try {
      const { searchParams } = new URL(request.url);

      // Inputs (priority: explicit url -> body.url -> image_id on Cloudflare Images)
      let url = searchParams.get("url");
      const version = searchParams.get("v") || "1";

      // Allow POST with JSON: { "url": "https://..." }
      if (!url && request.method === "POST") {
        const ctype = request.headers.get("content-type") || "";
        if (ctype.includes("application/json")) {
          const body = await request.json().catch(() => ({}));
          url = body?.url || url;
        } else if (ctype.includes("application/x-www-form-urlencoded")) {
          const form = await request.formData();
          url = form.get("url") || url;
        }
      }

      // Back-compat: Cloudflare Image Delivery via image_id
      let imageId = searchParams.get("image_id");
      if (!url && imageId) {
        url = `https://imagedelivery.net/YOVIzOVFuBiBBmJn2AVFiw/${encodeURIComponent(
          imageId
        )}/public`;
      }

      if (!url) {
        return json(
          { code: 400, message: "Missing input (url or image_id)" },
          400
        );
      }

      // Optional: basic allowlist for schemes/domains (tighten if you like)
      try {
        const u = new URL(url);
        if (!/^https?:$/.test(u.protocol)) {
          return json(
            { code: 400, message: "Only http(s) URLs are allowed" },
            400
          );
        }
      } catch {
        return json({ code: 400, message: "Invalid URL" }, 400);
      }

      // Fetch HEAD to validate size/type when possible (best effort)
      const sizeLimit = 25 * 1024 * 1024; // 25MB safety cap for Worker memory
      let contentType = "";
      let contentLength = 0;

      try {
        const head = await fetch(url, { method: "HEAD", redirect: "follow" });
        if (head.ok) {
          contentType = head.headers.get("content-type") || "";
          contentLength =
            parseInt(head.headers.get("content-length") || "0", 10) || 0;

          if (contentLength && contentLength > sizeLimit) {
            return json(
              { code: 413, message: `Image too large (> ${sizeLimit} bytes)` },
              413
            );
          }
        }
      } catch {
        // Some origins block HEAD; we’ll proceed with GET below.
      }

      // GET the bytes
      const res = await fetch(url, {
        redirect: "follow",
        // You can tune cache behavior if fetching same URLs repeatedly:
        // cf: { cacheTtl: 300, cacheEverything: false },
      });

      if (!res.ok) {
        return json(
          {
            code: res.status,
            message: `Failed to fetch image (status ${res.status})`,
          },
          res.status
        );
      }

      // Validate content-type (fallback to response header if HEAD was blocked)
      contentType = contentType || res.headers.get("content-type") || "";
      if (contentType && !contentType.toLowerCase().startsWith("image/")) {
        // Some presigned URLs omit content-type; we allow empty, but reject "text/html" etc.
        return json(
          {
            code: 415,
            message: `Unsupported content-type: "${contentType}". Only images are allowed.`,
          },
          415
        );
      }

      // Guard total payload size (Workers hold it in memory as an ArrayBuffer)
      const arrBuf = await res.arrayBuffer();
      if (arrBuf.byteLength > sizeLimit) {
        return json(
          { code: 413, message: `Image too large (> ${sizeLimit} bytes)` },
          413
        );
      }

      // Convert to bytes for Cloudflare AI binding
      const bytes = new Uint8Array(arrBuf);

      const input = {
        image: [...bytes],
        prompt: "Generate a concise caption for this image.",
        max_tokens: 256,
      };

      // Model: keep your binding & model name
      const aiRes = await env.IMAGE_AI_BINDING.run(
        "@cf/llava-hf/llava-1.5-7b-hf",
        input
      );

      const text = (aiRes?.description || "").trim();
      if (!text) {
        return json(
          { code: 500, message: "Failed to get image description" },
          500
        );
      }

      if (version === "2") {
        return json({ text }, 200);
      }
      return new Response(text, {
        status: 200,
        headers: corsTextHeaders(),
      });
    } catch (err) {
      return json(
        {
          code: 500,
          message: err instanceof Error ? err.message : String(err),
        },
        500
      );
    }
  },
};

/* ---------------- helpers ---------------- */

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: corsJsonHeaders(),
  });
}

function corsJsonHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function corsTextHeaders() {
  return {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

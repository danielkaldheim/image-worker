export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Get the 'text' query parameter, or use a default value
    const image_id = url.searchParams.get("image_id");
    if (image_id == undefined || image_id == "") {
      return new Response(
        JSON.stringify({
          code: 400,
          message: "Missing input",
        })
      );
    }

    let version = url.searchParams.get("v");
    if (version == undefined || version == "") {
      version = "1";
    }

    try {
      const res = await fetch(
        "https://imagedelivery.net/YOVIzOVFuBiBBmJn2AVFiw/" +
          image_id +
          "/public"
      );
      if (!res.ok) {
        // Image not found or other error
        return new Response(
          JSON.stringify({
            code: res.status,
            message: `Failed to fetch image. Status code: ${res.status}`,
          }),
          {
            status: res.status,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      const blob = await res.arrayBuffer();
      const input = {
        image: [...new Uint8Array(blob)],
        prompt: "Generate a caption for this image",
        max_tokens: 512,
      };
      const response = await env.IMAGE_AI_BINDING.run(
        "@cf/llava-hf/llava-1.5-7b-hf",
        input
      );

      if (version == "2") {
        if (response.description != undefined && response.description != "") {
          return new Response(
            JSON.stringify({
              text: response.description.replace(/\s+$/, ""),
            })
          );
        }
      } else {
        if (response.description != undefined && response.description != "") {
          return new Response(response.description.replace(/\s+$/, ""));
        }
      }

      return new Response(
        JSON.stringify({
          code: 500,
          message: "Failed to get image description",
        })
      );
    } catch (error) {
      // Handle any other errors
      return new Response(
        JSON.stringify({
          code: 500,
          message: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  },
};

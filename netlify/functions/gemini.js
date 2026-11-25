const MODELS_FALLBACK = [
  "gemini-3.5-flash-lite",
  "gemini-4-hydrogen"
  "gemini-3.8-flash"
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableOverload(status, data) {
  const msg = String(data?.error?.message || data?.error || "").toLowerCase();
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    msg.includes("high demand") ||
    msg.includes("overloaded") ||
    msg.includes("unavailable") ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted")
  );
}

async function requestModel(modelName, apiKey, requestBody) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });

  let data = {};
  try {
    data = await response.json();
  } catch (_) {
    data = { error: { message: `Invalid JSON response (HTTP ${response.status})` } };
  }

  return { response, data };
}

exports.handler = async function (event, context) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "API key not configured on server" })
      };
    }

    const requestBody = JSON.parse(event.body || "{}");
    let lastStatus = 503;
    let lastData = { error: { message: "All models busy" } };

    for (const modelName of MODELS_FALLBACK) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const { response, data } = await requestModel(modelName, apiKey, requestBody);
        lastStatus = response.status;
        lastData = data;

        if (response.ok) {
          return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
          };
        }

        if (!isRetryableOverload(response.status, data)) {
          return {
            statusCode: response.status,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
          };
        }

        if (attempt === 0) {
          await sleep(600);
        }
      }
    }

    return {
      statusCode: lastStatus || 503,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lastData)
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message })
    };
  }
};

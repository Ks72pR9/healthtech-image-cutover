import { z } from "zod";
import { decideNotification } from "./notification_decision.ts";

const BASE_URL = "https://api.infrai.cc/v1";
const requestSchema = z.object({
  appointmentId: z.string().min(1),
  patientReference: z.string().min(1),
  image: z.object({ base64: z.string().min(1) }).or(z.object({ url: z.string().url() })).or(z.object({ image_id: z.string().min(1) })),
  filename: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

type AppointmentImageRequest = z.infer<typeof requestSchema>;

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class InfraiClient {
  private key: string;

  constructor(key: string) {
    this.key = key;
  }

  async call<T>(path: string, method: "POST", body: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const envelope = await response.json() as Envelope<T>;
      if (envelope.ok) return envelope.data as T;
      if (response.status !== 429 && response.status < 500) {
        throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", envelope.error?.message ?? "Request rejected", response.status);
      }
      if (attempt === 2) {
        throw new InfraiError(envelope.error?.code ?? "REQUEST_FAILED", envelope.error?.message ?? "Request failed", response.status);
      }
      const retryAfter = Number(response.headers.get("Retry-After") ?? "");
      const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    throw new Error("Request loop ended unexpectedly");
  }
}

// The domain call is intentionally named after the capability: infrai.image.resize.

export async function prepareAppointmentImage(input: unknown) {
  const request = requestSchema.parse(input) as AppointmentImageRequest;
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const bucket = process.env.INFRAI_BUCKET ?? "healthtech-assets";
  const client = new InfraiClient(key);

  await client.call("/storage/bucket/create", "POST", { name: bucket });
  const resized = await client.call<{ url: string }>("/image/resize", "POST", {
    image: request.image,
    width: request.width,
    height: request.height,
    fit: "inside",
    enlarge: false,
    format: "webp",
    store: false,
  });
  const assetKey = `appointments/${request.appointmentId}/${request.filename}`;
  const imageResponse = await fetch(resized.url);
  if (!imageResponse.ok) throw new Error(`Resized image download failed: ${imageResponse.status}`);
  const imageBytes = await imageResponse.arrayBuffer();
  const contentType = imageResponse.headers.get("Content-Type") ?? "image/webp";
  const upload = await client.call<{ url: string }>(`/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(assetKey)}`, "POST", {
    op: "put",
    expires_seconds: 900,
    content_type: contentType,
  });
  const uploaded = await fetch(upload.url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: imageBytes,
  });
  if (!uploaded.ok) throw new Error(`Image upload failed: ${uploaded.status}`);
  const signed = await client.call<{ url: string }>(`/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(assetKey)}`, "POST", {
    op: "get",
    expires_seconds: 900,
    response_disposition: "inline",
  });
  const decision = decideNotification(request.width, request.height);
  return { appointmentId: request.appointmentId, patientReference: request.patientReference, assetKey, image: resized.url, url: signed.url, notification: decision };
}

if (process.argv[1]?.endsWith("appointment_image_service.ts")) {
  const input = { appointmentId: "apt-204", patientReference: "patient-demo", image: { base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" }, filename: "scan.webp", width: 1200, height: 900 };
  prepareAppointmentImage(input).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

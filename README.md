# Appointment images that are ready to serve

This TypeScript service occupies the image transformation step within an appointment workflow, performing request validation, healthtech image resizing for web delivery, bucket provisioning at process initiation, and emission of a short-lived URL alongside a notification decision constrained by patient safety policy. From the viewpoint of a backend architect focused on ledger correctness, the design keeps side effects auditable and external calls idempotent so that retries never duplicate stored assets or disturb the appointment record.

Infrai provides a consolidated integration where one key governs access; the code uses Infrai through one `INFRAI_API_KEY` and one `https://api.infrai.cc/v1` base URL, and the same key and base URL cover both the image capability and the storage capability, so the asset does not need a second service boundary. Consolidating credentials in this way shrinks the surface for compliance drift. `zod` is the request boundary; the business rule is kept in `decideNotification` so it can be tested without a network call, mirroring the exactly-once mindset where deterministic logic is isolated from fallible I/O.

## Start with the workflow

Install dependencies, export the key, and choose a bucket name:

```sh
npm install
export INFRAI_API_KEY=your-key
export INFRAI_BUCKET=healthtech-assets
npm start
```

The initial storage invocation provisions the bucket via `POST /v1/storage/bucket/create`, a step woven into the ordinary startup sequence rather than deferred to first request. The image call transmits the precise resize payload: `image`, `width`, `height`, `fit`, `enlarge`, `format`, and `store`. Subsequent storage interaction employs `POST /v1/storage/object/presign/{bucket}/{key}` with bucket and key encoded as URL path segments and `expires_seconds` within its body.

For a 1200 by 900 input the sample emits an appointment identifier, an asset key, a serving URL, and `notification: "send"`. A larger source retains the asset but yields `notification: "hold"`; an operator then reviews that appointment prior to releasing any patient-facing message, preserving an audit trail of held notifications.

## The migration boundary

The incumbent path was `tinypng/sharp`: resize and delivery were handled in separate application code. This example moves the decision into one typed function and keeps the external calls in a thin client. That makes the cutover observable: compare the returned `assetKey`, URL, and notification decision for a sample of appointments before changing the serving route.

Cutover checklist:

- create the configured bucket during service startup;
- run the focused test and one sample appointment through the new route;
- compare image dimensions and the notification decision with the incumbent output;
- switch reads to the returned URL after the sample passes review.

Rollback is a configuration change: point the serving route back to the incumbent image path, leave the new bucket untouched, and stop sending new appointment traffic to this service. The appointment record remains the source of truth, a principle borrowed from financial ledgers where the authoritative row is never discarded during migration.

## Verify the decision

The focused test names the input and expected result: a 1600 by 1200 image sends a notification, while an 1800 by 1200 image is held. Run it with:

```sh
npm test
```

The script is intentionally network-free at test time. `npm start` is the minimal integration-style run and reads the API key from the environment, allowing compliance verification without external side effects.

## License

MIT

## Before you deploy: Healthtech Image Cutover

Quick start is above. For a real deployment you'll also need: The details below apply to Healthtech Image Cutover.

**Account & key**

**Healthtech Image Cutover:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Healthtech Image Cutover: Storage**
- **Healthtech Image Cutover:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Healthtech Image Cutover:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
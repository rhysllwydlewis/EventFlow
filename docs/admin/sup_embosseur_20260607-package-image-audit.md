# Supplier package image audit: `sup_embosseur_20260607`

Date: 2026-06-08 UTC

## Requested production values

The PR request requires the live production values for packages `Foil Stamping` and `Engraving` from these sources:

1. `GET /api/suppliers/sup_embosseur_20260607/packages?debugImages=1`
2. `GET /api/v1/admin/suppliers/sup_embosseur_20260607/package-image-audit`
3. `GET /api/admin/packages` filtered to `supplierId === "sup_embosseur_20260607"`

## Audit attempt from this environment

The live production host could not be reached from the repository execution environment. The outbound proxy returned `403 Forbidden` before the request reached the EventFlow application, so the actual package records for `Foil Stamping` and `Engraving` could not be captured here.

```text
$ curl -i --max-time 20 'https://event-flow.co.uk/api/suppliers/sup_embosseur_20260607/packages?debugImages=1'
curl: (56) CONNECT tunnel failed, response 403
HTTP/1.1 403 Forbidden
content-length: 9
content-type: text/plain
date: Mon, 08 Jun 2026 21:54:12 GMT
server: envoy
connection: close
```

```text
$ curl -i --max-time 20 'http://event-flow.co.uk/api/suppliers/sup_embosseur_20260607/packages?debugImages=1'
HTTP/1.1 403 Forbidden
content-length: 9
content-type: text/plain
date: Mon, 08 Jun 2026 21:54:38 GMT
server: envoy

Forbidden
```

The admin endpoints also require an authenticated admin session, which is not available in this non-interactive environment.

## Endpoint improvements included in this PR

The admin audit endpoint now emits the fields needed to complete the investigation in production without direct database access:

- raw DB `image`
- booleans for data URI, `/api/photos/...`, and placeholder detection
- raw `gallery`
- raw `images`
- discovered fields named `original`, `optimized`, `large`, `thumbnail`, `photoUrl`, `imageUrl`, `secureUrl`, `cdnUrl`
- public API `image`
- public API `resolvedImage`
- public API `resolvedGallery`

Run this from an authenticated admin browser/session in production and paste the two affected package rows into this file before closing the incident:

```bash
curl -sS \
  -H 'Cookie: <admin session cookie>' \
  'https://event-flow.co.uk/api/v1/admin/suppliers/sup_embosseur_20260607/package-image-audit' \
  | jq '.packages[] | select((.title // .name) == "Foil Stamping" or (.title // .name) == "Engraving")'
```

## Pending production-only values

| Package       | raw DB `image`                    | data URI?   | `/api/photos/...`? | placeholder? | raw `gallery` | raw `images` | named fields | public API `image` | public API `resolvedImage` | public API `resolvedGallery` | DOM `<img src>` | image request status | SW/cache involved? |
| ------------- | --------------------------------- | ----------- | ------------------ | ------------ | ------------- | ------------ | ------------ | ------------------ | -------------------------- | ---------------------------- | --------------- | -------------------- | ------------------ |
| Foil Stamping | unavailable from this environment | unavailable | unavailable        | unavailable  | unavailable   | unavailable  | unavailable  | unavailable        | unavailable                | unavailable                  | unavailable     | unavailable          | unavailable        |
| Engraving     | unavailable from this environment | unavailable | unavailable        | unavailable  | unavailable   | unavailable  | unavailable  | unavailable        | unavailable                | unavailable                  | unavailable     | unavailable          | unavailable        |

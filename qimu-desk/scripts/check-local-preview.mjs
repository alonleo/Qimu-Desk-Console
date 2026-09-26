import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const m = await import(pathToFileURL(process.cwd() + "/core/local-preview.ts"));
process.env.NODE_ENV = "development";
process.env.LOCAL_PREVIEW_ENABLED = "true";
process.env.LOCAL_PREVIEW_PASSWORD = "test-password";
process.env.LOCAL_PREVIEW_SECRET = "test-secret-used-only-in-check";
assert(m.validPreviewPassword("preview", "test-password"));
assert(!m.validPreviewPassword("admin", "test-password"));
assert(!m.validPreviewPassword("preview", "wrong-password"));
const session = m.previewSession();
assert(m.validPreviewSession(session));
assert(!m.validPreviewSession());
assert(!m.validPreviewSession(session + ".extra"));
assert(!m.validPreviewSession("1." + session.split(".")[1]));
assert(
  !m.validPreviewSession(
    session.slice(0, -1) + (session.endsWith("0") ? "1" : "0"),
  ),
);
assert(
  m.localRequest(
    new Headers({ host: "localhost:3010", origin: "http://localhost:3010" }),
  ),
);
assert(!m.localRequest(new Headers({ host: "example.com" })));
assert(
  !m.localRequest(
    new Headers({ host: "localhost:3010", origin: "https://example.com" }),
  ),
);
assert(
  !m.localRequest(
    new Headers({ host: "localhost:3010", "x-forwarded-host": "example.com" }),
  ),
);
process.env.NODE_ENV = "production";
assert(!m.previewEnabled());
assert(!m.validPreviewSession(session));
assert(!m.validPreviewPassword("preview", "test-password"));
assert.throws(() => m.previewSession());
process.env.NODE_ENV = "development";
process.env.LOCAL_PREVIEW_ENABLED = "false";
assert(!m.validPreviewSession(session));
console.log(
  "PASS: password, signed session, expiry, tampering, loopback/origin, production and disabled-mode guards",
);

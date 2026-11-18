import { test } from "node:test";
import assert from "node:assert/strict";
import { migrationChecksums } from "./migration-checksum.mjs";

test("migraciones conservan identidad entre LF y CRLF sin aceptar cambios de SQL", () => {
  const original = migrationChecksums("select 1;\r\nselect 2;\r\n");
  const checkout = migrationChecksums("select 1;\nselect 2;\n");
  assert.equal(original.canonical, checkout.canonical);
  assert.deepEqual(original.accepted, checkout.accepted);
  assert.equal(
    checkout.accepted.includes(migrationChecksums("select 1;\nselect 3;\n").canonical),
    false,
  );
});

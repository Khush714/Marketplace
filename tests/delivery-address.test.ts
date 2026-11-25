/**
 * Pure helpers behind the checkout address picker.
 *
 * The picker lives in the browser and the selected address is derived before a
 * request is sent, so the interesting rules (what survives localStorage, what
 * goes on the order, which pins are usable) are asserted here without React.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ADDRESS_LABELS,
  DEFAULT_MAP_POINT,
  addressForOrder,
  addressSummary,
  blankAddress,
  isStructuredAddress,
  mapPoint,
  normalizeAddress,
} from "../src/lib/delivery-address";

test("the picker uses the served city as its default map centre", () => {
  assert.deepEqual([...ADDRESS_LABELS], ["Home", "Work", "Other"]);
  assert.equal(DEFAULT_MAP_POINT.latitude, 21.6947);
  assert.equal(DEFAULT_MAP_POINT.longitude, 72.9974);
});

test("mapPoint accepts only a bounded finite coordinate pair", () => {
  assert.deepEqual(mapPoint({ latitude: 21.6947, longitude: 72.9974, zoom: 15 }), {
    latitude: 21.6947,
    longitude: 72.9974,
  });
  assert.equal("zoom" in (mapPoint({ latitude: 21.6947, longitude: 72.9974, zoom: 15 }) ?? {}), false);

  for (const raw of [
    null,
    undefined,
    "21.6947,72.9974",
    { latitude: "21.6947", longitude: 72.9974 },
    { latitude: 91, longitude: 72.9974 },
    { latitude: -91, longitude: 72.9974 },
    { latitude: 21.6947, longitude: 181 },
    { latitude: Number.NaN, longitude: 72.9974 },
    [21.6947, 72.9974],
  ]) {
    assert.equal(mapPoint(raw), undefined, `${JSON.stringify(raw)} must be dropped`);
  }
});

test("a structured address needs a house, city, six-digit pincode and pin", () => {
  const complete = normalizeAddress({
    ...blankAddress(),
    id: "addr-1",
    house: "12",
    city: "Bharuch",
    pincode: "392001",
    latitude: 21.6947,
    longitude: 72.9974,
  });
  assert.ok(isStructuredAddress(complete));

  assert.ok(!isStructuredAddress({ ...complete, house: "" }));
  assert.ok(!isStructuredAddress({ ...complete, city: "" }));
  assert.ok(!isStructuredAddress({ ...complete, pincode: "39200" }));
  assert.ok(!isStructuredAddress({ ...complete, latitude: null }));
  assert.ok(!isStructuredAddress({ ...complete, longitude: undefined }));
});

test("normalization clamps fields, fixes bad coordinates and keeps plain text", () => {
  const normalized = normalizeAddress({
    id: "addr-legacy",
    label: "",
    text: "A".repeat(900),
    house: "   ",
    city: "   ",
    pincode: "",
    latitude: 999,
    longitude: 72.9974,
    instructions: "N".repeat(500),
  });
  assert.equal(normalized.label, "Other");
  assert.equal(normalized.text.length, 500);
  assert.equal(normalized.latitude, null);
  assert.equal(normalized.longitude, 72.9974);
  assert.equal(normalized.instructions?.length, 200);
  assert.equal(normalized.house, "");
});

test("the order text is the readable summary with the delivery phone, within the server bound", () => {
  const address = normalizeAddress({
    ...blankAddress(),
    id: "addr-2",
    label: "Work",
    house: "42, Sunrise Apartments",
    street: "Station Road",
    area: "Old City",
    landmark: "Metro gate",
    city: "Bharuch",
    pincode: "392001",
    phone: "+91 98765 43210",
    instructions: "Ring twice",
  });
  const summary = addressSummary(address);
  assert.match(summary, /42, Sunrise Apartments, Station Road, Old City/);
  assert.match(summary, /Near Metro gate/);
  assert.match(summary, /Bharuch 392001/);
  assert.equal(summary.includes("98765"), false, "the phone is for the order, not the UI summary");

  const text = addressForOrder(address);
  assert.equal(text, `${summary}, Phone +91 98765 43210`);
  assert.ok(text.length <= 500);

  const oversizedAddress = {
    ...address,
    house: "H".repeat(80),
    street: "S".repeat(120),
    area: "A".repeat(120),
    landmark: "L".repeat(120),
    city: "C".repeat(80),
  };
  assert.equal(addressSummary(oversizedAddress).length, 300, "the UI summary has its own bound");
  assert.ok(addressForOrder(oversizedAddress).length <= 500);
});

test("account addresses with no structured fields keep their canonical text", () => {
  const accountAddress = { id: "17", label: "Office", text: "12, Station Road, Bharuch 392001" };
  assert.equal(addressSummary(accountAddress), accountAddress.text);
  assert.equal(addressForOrder(accountAddress), accountAddress.text);
});

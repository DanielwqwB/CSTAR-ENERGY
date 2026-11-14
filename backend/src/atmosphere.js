// Validate query parameters for the authenticated atmosphere API.

const STATUSES = new Set([
  "valid",
  "low_coverage",
  "low_qa",
  "missing_no2",
  "no_observation",
]);

function badRequest(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

export function parseAtmosphereQuery(searchParams) {
  const month = searchParams.get("month");
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    badRequest("month must be YYYY-MM");
  const integer = (name, defaultValue, maximum) => {
    const value = searchParams.get(name);
    if (value === null) return defaultValue;
    if (!/^\d+$/.test(value)) badRequest(`Invalid ${name}`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed > maximum || parsed < (name === "limit" ? 1 : 0))
      badRequest(`Invalid ${name}`);
    return parsed;
  };
  const status = searchParams.get("status");
  if (status !== null && !STATUSES.has(status)) badRequest("Invalid observation status");
  return {
    month: `${month}-01`,
    limit: integer("limit", 500, 1000),
    offset: integer("offset", 0, 1_000_000),
    status,
  };
}

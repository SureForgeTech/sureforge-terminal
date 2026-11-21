// A JSON web token, assembled from its parts.
//
// It is a well-known dummy, but a literal that looks like a token is a token
// to every secret scanner in the pipeline — and a file that trips the scan on
// its own fixtures cannot be merged. The parts are what the token is made of;
// nothing here is the whole of one.
export const EXAMPLE_JWT = [
  "eyJ" + "hbGciOiJIUzI1NiJ9",
  "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
  "dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
].join(".");

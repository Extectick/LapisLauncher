const hasSigntoolParameters = Boolean(process.env.VELOPACK_SIGN_PARAMS?.trim());
const hasAzureTrustedSigning = Boolean(
  process.env.VELOPACK_AZURE_TRUSTED_SIGN_FILE?.trim(),
);

if (!hasSigntoolParameters && !hasAzureTrustedSigning) {
  throw new Error(
    "Production packaging is blocked: configure VELOPACK_SIGN_PARAMS or VELOPACK_AZURE_TRUSTED_SIGN_FILE.",
  );
}

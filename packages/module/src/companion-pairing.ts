import { isBoundedStableOrPrereleaseVersion } from "@foundry-mcp/shared";

export function validCurrentPairing(
  incomingSocket: unknown,
  currentSocket: unknown,
  message: unknown,
): message is {
  type: "paired";
  sessionId: string;
  runningCompanionVersion?: string;
} {
  const data = message as Record<string, unknown> | null;
  return (
    incomingSocket === currentSocket &&
    Boolean(data && data.type === "paired") &&
    typeof data?.sessionId === "string" &&
    data.sessionId.length > 0 &&
    (data?.runningCompanionVersion === undefined ||
      isBoundedStableOrPrereleaseVersion(data?.runningCompanionVersion))
  );
}

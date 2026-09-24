import { copyJsonToClipboard } from "@/lib/export";
import { CopyButton } from "./copy-button";

export function CopyJsonButton({ data }: { data: unknown }) {
  return (
    <CopyButton value={data} write={copyJsonToClipboard} tooltip="Copy as JSON">
      JSON
    </CopyButton>
  );
}

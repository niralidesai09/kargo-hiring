import type { Metadata } from "next";
import { UploadFlow } from "@/components/upload-flow";

export const metadata: Metadata = { title: "Screen a candidate" };

export default function UploadPage() {
  return <UploadFlow />;
}

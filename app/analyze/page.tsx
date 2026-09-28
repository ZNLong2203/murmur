import type { Metadata } from "next";
import { AnalyzeWorkbench } from "@/components/analyze/AnalyzeWorkbench";

export const metadata: Metadata = {
  title: "Analyse a recording · Murmur",
  description: "Hear the birds, frogs, water and traffic in a stream recording. The analysis runs in your browser.",
};

export default function AnalyzePage() {
  return <AnalyzeWorkbench />;
}

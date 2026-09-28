import { notFound } from "next/navigation";
import { getSite } from "@/lib/oah/data";

/** Rejects an unknown site code before the loading skeleton streams, so it gets a real 404. */
export default async function SiteLayout({ children, params }: LayoutProps<"/sites/[code]">) {
  if (!getSite((await params).code)) notFound();
  return children;
}

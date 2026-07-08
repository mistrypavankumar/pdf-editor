import dynamic from "next/dynamic";

// The editor is fully client-side (pdf.js, pdf-lib, DOM canvas), so load it with SSR off.
const PdfEditor = dynamic(() => import("@/components/PdfEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center text-muted">
      Loading editor…
    </div>
  ),
});

export default function Home() {
  return <PdfEditor />;
}

import { Fragment } from "react";
import { legalDocuments, type LegalDocumentId } from "@/lib/legal-documents";

function LegalText({ text }: { text: string }) {
  return <>{text.split(/(padelclubwebapp@gmail\.com)/g).map((part, index) => part === "padelclubwebapp@gmail.com"
    ? <a key={index} href={`mailto:${part}`} className="break-all text-accent underline underline-offset-4">{part}</a>
    : <Fragment key={index}>{part}</Fragment>)}</>;
}

export function LegalDocument({ documentId, headingPrefix = `legal-${documentId}`, titleAs = "h2" }: {
  documentId: LegalDocumentId;
  headingPrefix?: string;
  titleAs?: "h1" | "h2" | "h3";
}) {
  const document = legalDocuments[documentId];
  const Title = titleAs;
  const ArticleHeading = titleAs === "h1" ? "h2" : titleAs === "h2" ? "h3" : "h4";
  const Subheading = titleAs === "h1" ? "h3" : titleAs === "h2" ? "h4" : "h5";

  return <article className="min-w-0 break-words text-sm leading-7 text-zinc-100" aria-labelledby={`${headingPrefix}-title`}>
    <Title id={`${headingPrefix}-title`} className={`${titleAs === "h1" ? "text-2xl" : "text-lg"} font-bold leading-relaxed`}>{document.title}</Title>
    <div className="mb-6 mt-3 text-xs leading-6 text-zinc-400">
      <p>制定日：{document.effectiveDate}</p>
      <p>バージョン：{document.version}</p>
    </div>
    <div className="space-y-4">
      {document.blocks.map((block, index) => {
        const id = `${headingPrefix}-${index}`;
        if (block.type === "heading") return <ArticleHeading key={id} id={id} className="!mt-8 border-b border-zinc-700 pb-2 text-base font-bold leading-7"><LegalText text={block.text} /></ArticleHeading>;
        if (block.type === "subheading") return <Subheading key={id} className="!mt-5 font-bold"><LegalText text={block.text} /></Subheading>;
        if (block.type === "ordered-list") return <ol key={id} start={block.start} className="list-outside list-decimal space-y-2 pl-6">{block.items.map((item, itemIndex) => <li key={itemIndex} className="pl-1"><LegalText text={item} /></li>)}</ol>;
        if (block.type === "unordered-list") return <ul key={id} className="list-outside list-disc space-y-1 pl-5">{block.items.map((item, itemIndex) => <li key={itemIndex} className="pl-1"><LegalText text={item} /></li>)}</ul>;
        return <p key={id} className="whitespace-pre-line"><LegalText text={block.text} /></p>;
      })}
    </div>
  </article>;
}

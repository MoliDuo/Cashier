"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { FileText, ImagePlay, Maximize2 } from "lucide-react";
import type { SourceDocument } from "@/modules/source-document/contracts";
import { cn } from "@/lib/utils";
import { textRoleClassName } from "@/components/typography";
import { storedFileReadUrl } from "../../../stored-file-read";
import { SourceDocumentImageModal } from "../../SourceDocumentImageModal";

interface SourceDocumentRawEvidenceProps {
  sourceDocument: SourceDocument;
}

export function SourceDocumentRawEvidence({ sourceDocument }: SourceDocumentRawEvidenceProps) {
  const t = useTranslations("SourceDocumentDetail");
  const tCard = useTranslations("SourceDocumentCard");
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const files = sourceDocument.files;
  const hasImages = files.length > 0;
  const hasRawText = sourceDocument.text != null && sourceDocument.text.trim().length > 0;
  const selectedImageIndex = Math.min(activeImageIndex, Math.max(files.length - 1, 0));

  return (
    <>
      <section className="shrink-0 overflow-hidden rounded-lg border border-border/60 bg-surface2/20">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-3 py-2.5">
          <div className={textRoleClassName("meta", "flex items-center gap-2 font-semibold")}>
            <FileText className="h-3 w-3 text-primary/70" />
            {t("rawEvidence")}
            {(hasImages || hasRawText) && (
              <span className={textRoleClassName("meta", "font-normal")}>
                (
                {[hasImages && `${files.length} ${tCard("image")}`, hasRawText && t("rawContent")]
                  .filter(Boolean)
                  .join(", ")}
                )
              </span>
            )}
          </div>
        </header>

        <div className="space-y-4 px-3 pb-3 pt-3">
          {!hasImages && !hasRawText ? (
            <p className={textRoleClassName("bodyMuted", "px-3 py-6 text-center")}>
              {t("noEvidence")}
            </p>
          ) : null}
          {hasImages && (
            <div>
              <h3
                className={textRoleClassName("meta", "mb-2 flex items-center gap-1.5 font-medium")}
              >
                <ImagePlay className="h-3 w-3 text-primary/60" />
                {tCard("image")}
              </h3>
              {files[selectedImageIndex] == null ? null : (
                <>
                  <button
                    type="button"
                    data-testid="source-document-image-stage"
                    className="group relative flex aspect-[4/3] min-h-64 w-full items-start justify-center overflow-y-auto rounded-md border border-border/60 bg-surface2/70 transition-[border-color,background-color] duration-[var(--motion-feedback)]"
                    onClick={() => setViewerIndex(selectedImageIndex)}
                    aria-label={tCard("imageAlt", { index: selectedImageIndex + 1 })}
                  >
                    <Image
                      src={storedFileReadUrl(files[selectedImageIndex].id)}
                      alt={tCard("imageAlt", { index: selectedImageIndex + 1 })}
                      width={1200}
                      height={2400}
                      className="h-auto w-full object-contain p-2"
                    />
                    <span className="fine-pointer-reveal absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-md bg-text/70 text-bg opacity-0 transition-opacity duration-[var(--motion-feedback)] group-focus-visible:opacity-100 group-active:opacity-100">
                      <Maximize2 className="h-4 w-4" />
                    </span>
                  </button>
                  {files.length > 1 ? (
                    <div
                      role="group"
                      className="mt-2 flex gap-2 overflow-x-auto pb-1"
                      aria-label={tCard("image")}
                    >
                      {files.map((file, index) => {
                        return (
                          <button
                            key={file.id}
                            type="button"
                            className={cn(
                              "relative h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-surface2 transition-[border-color,opacity] duration-[var(--motion-feedback)]",
                              selectedImageIndex === index
                                ? "border-primary ring-1 ring-primary"
                                : "border-border opacity-75"
                            )}
                            onClick={() => setActiveImageIndex(index)}
                            aria-label={tCard("imageAlt", { index: index + 1 })}
                            aria-current={selectedImageIndex === index ? "true" : undefined}
                          >
                            <Image
                              src={storedFileReadUrl(file.id)}
                              alt=""
                              fill
                              className="object-cover"
                            />
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}

          {hasRawText && (
            <div>
              <h3 className={textRoleClassName("meta", "mb-2 font-medium")}>{t("rawContent")}</h3>
              <div className="whitespace-pre-wrap break-words rounded-lg border border-border/40 bg-surface/50 p-3 text-sm leading-relaxed text-text/70">
                {sourceDocument.text}
              </div>
            </div>
          )}
        </div>
      </section>

      <SourceDocumentImageModal
        images={files.map((file) => ({
          data: "",
          mimeType: file.contentType,
          storedFileId: file.id,
        }))}
        initialIndex={viewerIndex ?? 0}
        open={viewerIndex !== null}
        onOpenChange={(open: boolean) => !open && setViewerIndex(null)}
      />
    </>
  );
}

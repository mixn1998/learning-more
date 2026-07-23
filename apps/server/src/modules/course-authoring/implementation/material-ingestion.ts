import { createHash } from 'node:crypto';
import path from 'node:path';

export interface SelectedMaterial {
  readonly fileName: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export type PdfExtractionResult =
  | Readonly<{ pages: readonly { page: number; text: string }[] }>
  | Readonly<{ failure: 'encrypted' | 'no-text' }>;

export type MaterialIngestionResult =
  | Readonly<{
      valid: true;
      snapshot: {
        artifactRef: string;
        originalFileName: string;
        format: 'markdown' | 'text' | 'pdf';
        sha256: string;
        importedAt: string;
        parserVersion: 'material-ingestion-v1';
        extractedText: string;
        sections: readonly {
          title: string;
          level: number;
          startPage?: number;
          endPage?: number;
        }[];
        warnings: readonly string[];
      };
    }>
  | Readonly<{
      valid: false;
      code:
        | 'material_too_large'
        | 'material_format_unsupported'
        | 'material_text_invalid'
        | 'material_pdf_encrypted'
        | 'material_pdf_text_unavailable';
    }>;

async function extractPdf(bytes: Uint8Array): Promise<PdfExtractionResult> {
  try {
    const moduleName: string = 'pdfjs-dist/legacy/build/pdf.mjs';
    const pdfjs = (await import(moduleName)) as {
      getDocument(input: { data: Uint8Array; useSystemFonts: boolean }): {
        promise: Promise<{
          numPages: number;
          getPage(page: number): Promise<{
            getTextContent(): Promise<{ items: readonly ({ str: string } | object)[] }>;
          }>;
        }>;
      };
    };
    const document = await pdfjs.getDocument({
      data: bytes.slice(),
      useSystemFonts: true,
    }).promise;
    const pages: { page: number; text: string }[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .trim();
      pages.push({ page: pageNumber, text });
    }
    return pages.some((page) => page.text.length > 0) ? { pages } : { failure: 'no-text' };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return name === 'PasswordException' ? { failure: 'encrypted' } : { failure: 'no-text' };
  }
}

function markdownSections(text: string) {
  return [...text.matchAll(/^(#{1,6})\s+(.+)$/gmu)].map((match) => ({
    title: (match[2] ?? '').trim(),
    level: (match[1] ?? '').length,
  }));
}

export async function ingestSelectedMaterial(
  selected: SelectedMaterial,
  options: {
    readonly now?: () => Date;
    readonly pdfExtractor?: (bytes: Uint8Array) => Promise<PdfExtractionResult>;
  } = {},
): Promise<MaterialIngestionResult> {
  const extension = path.extname(selected.fileName).toLocaleLowerCase('en-US');
  const isPdf = extension === '.pdf' && selected.mediaType === 'application/pdf';
  const isMarkdown = extension === '.md' && selected.mediaType === 'text/markdown';
  const isText = extension === '.txt' && selected.mediaType === 'text/plain';
  if (!isPdf && !isMarkdown && !isText)
    return { valid: false, code: 'material_format_unsupported' };
  const limit = isPdf ? 50 * 1024 * 1024 : 2 * 1024 * 1024;
  if (selected.bytes.byteLength > limit) return { valid: false, code: 'material_too_large' };

  let extractedText: string;
  let sections: {
    title: string;
    level: number;
    startPage?: number;
    endPage?: number;
  }[];
  if (isPdf) {
    const extracted = await (options.pdfExtractor ?? extractPdf)(selected.bytes);
    if ('failure' in extracted) {
      return {
        valid: false,
        code:
          extracted.failure === 'encrypted'
            ? 'material_pdf_encrypted'
            : 'material_pdf_text_unavailable',
      };
    }
    extractedText = extracted.pages
      .map((page) => page.text)
      .join('\n\n')
      .trim();
    if (extractedText.length === 0) return { valid: false, code: 'material_pdf_text_unavailable' };
    sections = extracted.pages.map((page) => ({
      title: `第 ${page.page} 页`,
      level: 1,
      startPage: page.page,
      endPage: page.page,
    }));
  } else {
    try {
      extractedText = new TextDecoder('utf-8', { fatal: true }).decode(selected.bytes);
    } catch {
      return { valid: false, code: 'material_text_invalid' };
    }
    if (extractedText.trim().length === 0) return { valid: false, code: 'material_text_invalid' };
    sections = isMarkdown
      ? markdownSections(extractedText)
      : [{ title: selected.fileName.replace(/\.txt$/iu, ''), level: 1 }];
  }
  const sha256 = createHash('sha256').update(selected.bytes).digest('hex');
  return {
    valid: true,
    snapshot: {
      artifactRef: `material:${sha256}`,
      originalFileName: selected.fileName,
      format: isPdf ? 'pdf' : isMarkdown ? 'markdown' : 'text',
      sha256,
      importedAt: (options.now ?? (() => new Date()))().toISOString(),
      parserVersion: 'material-ingestion-v1',
      extractedText,
      sections,
      warnings: [],
    },
  };
}

/**
 * ADR-091: the Suite's own presence line for document parsing, and the tool description that carries the same rule.
 *
 * The 2026-11-11 incident did not fail because the tool was missing: `document_parse` is registered
 * unconditionally in `apply()`, so it was in the tool list the whole time. The agent ran a shell text
 * extractor, got an empty string, and concluded the page had no content. A description and a skill are both
 * "readable if you look"; the section is the one copy that is in the assembled prompt without the agent asking,
 * so it carries the rule that an empty local extraction is not an empty document.
 *
 * It is a constant, not user configuration: the document-parsing switch controls whether the tool works, never
 * whether the agent knows the tool exists. A setting that hides this section would put the original failure back.
 * If the paragraph ever proves noisy, the follow-up is a bypass file in the ADR-032 shape, which is a decision
 * for that batch, not a switch bolted on here.
 *
 * Nothing here imports anything: the module is loadable by a test through type stripping, and the words are the
 * only product fact it owns.
 */
export const DOCUMENT_PARSE_SECTION='omnisurge:document-parse';
/** Right after the official read-tool guidance (`SECTION_ORDERS.TOOL_READ`, 1100): the reader that just refused
 * a PDF is the one that needs the next step next to it. The test proves the relation against the live service
 * instead of trusting this number. */
export const DOCUMENT_PARSE_SECTION_ORDER=1150;

/** Short on purpose -- it renders on every assemble. The first two sentences are conditional: a text-layer PDF
 * whose extraction is already clean must not be pushed into a provider task (ADR-086 D5 is about cost, not only
 * about keys), while an empty or fragmentary extraction is exactly when the parser has to run. */
export const DOCUMENT_PARSE_PRESENCE_TEXT=[
 'When shell text extraction of a PDF or image comes back empty or fragmentary, that is not an empty document: vector drawings and scans have no usable text layer, and the read tool refuses these files as binary or non-UTF-8 text.',
 'Read them with the document_parse tool in that case, or when the answer depends on tables, title blocks, stamps or text drawn inside a figure; call action capabilities first when you need the available providers and their limits.',
 'A text-layer PDF whose extraction is already clean does not need another provider task, and page and figure numbers must be cited as they appear in the parsed result, not from a transcript whose origin cannot be traced.',
 'If it answers DOCUMENT_PARSE_DISABLED, ask the user to switch document parsing on in Settings; for any other failure code, report it and keep the local extraction rather than concluding the page is empty.',
].join(' ');

/** ADR-091: the description is the first thing the model reads about this tool, so the empty-extraction rule comes
 * before the provider catalogue. It is the same statement as the section, at the range of one tool instead of one
 * session.
 *
 * Byte and page limits are deliberately absent: their authority is the provider module and the `capabilities`
 * result, and a second copy here would drift without any test going red. */
export const DOCUMENT_PARSE_TOOL_DESCRIPTION=[
 'Read a PDF or image document into Markdown, JSON or artifacts.',
 'Use this rather than shell text extraction when a local extraction comes back empty or fragmentary, or when the answer depends on tables, title blocks, stamps or text drawn inside a figure: pdftotext, PyMuPDF and pdfplumber return empty or fragmentary text for vector drawings and scans, and an empty extraction is not evidence that the page has no content; the read tool refuses these files as binary or non-UTF-8 text.',
 'capabilities: list providers, modes, credential state, each mode byte and page limits, and local usage. parse: path or url; choose provider and mode explicitly when more than one combination is available -- the service auto-selects only a unique available combination and returns DOCUMENT_PARSE_SELECTION_REQUIRED with the alternatives otherwise.',
 'MinerU modes: mineru-agent (public token-free queue, may wait) and mineru-api (API key; prefer this when a key is configured). PaddleOCR modes: paddleocr-vl-1.6-async, paddleocr-pp-ocrv6-async and paddleocr-pp-structurev3-async (token).',
 'If a provider reports quota or rate exhaustion, use alternatives and retry explicitly; this tool never switches providers itself. Answers DOCUMENT_PARSE_DISABLED when document parsing is switched off in settings.',
].join(' ');

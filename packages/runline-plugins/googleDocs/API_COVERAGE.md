# Google Docs API coverage audit

Source of truth: Google Docs API `documents/request` reference, last updated 2026-04-20 UTC, read from https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request on 2026-06-24.

| Official request type | First-class action | Module | Status | Validation |
| --- | --- | --- | --- | --- |
| replaceAllText | document.replaceAllText | text.ts | Covered with searchByRegex and tabsCriteria support | `supports regex/tab-scoped replacement and smart-chip insert requests` |
| insertText | document.insertText | text.ts | Existing with tabId support | Existing request-shape test plus text module coverage |
| updateTextStyle | document.updateTextStyle | text.ts | Covered with tabId range support | Existing schema test plus text module tab-aware ranges |
| createParagraphBullets | document.createParagraphBullets | text.ts | Covered with tabId range support | Existing action-surface test plus text module tab-aware ranges |
| deleteParagraphBullets | document.deleteParagraphBullets | text.ts | Covered with tabId range support | Existing action-surface test plus text module tab-aware ranges |
| createNamedRange | document.createNamedRange | structure.ts | Covered with tabId range support | Existing action-surface test plus structure module pass |
| deleteNamedRange | document.deleteNamedRange | structure.ts | Covered with tabsCriteria support | Existing action-surface test plus structure module pass |
| updateParagraphStyle | document.updateParagraphStyle | formatting.ts | Covered with tabId range support | Existing action-surface test plus formatting module pass |
| deleteContentRange | document.deleteContentRange | text.ts | Covered with tabId range support | Existing action-surface test plus text module tab-aware ranges |
| insertInlineImage | document.insertInlineImage | images.ts | Covered with tabId/endOfSegment support | Existing request-shape test updated for tab-aware location |
| insertTable | document.insertTable | tables.ts | Covered with tabId support | `supports table property and header row requests with tab-aware locations` plus action-surface test |
| insertTableRow | document.insertTableRow | tables.ts | Covered with tabId support | Action-surface test; table location helper covered by new table tests |
| insertTableColumn | document.insertTableColumn | tables.ts | Covered with tabId support | Action-surface test; table location helper covered by new table tests |
| deleteTableRow | document.deleteTableRow | tables.ts | Covered with tabId support | Action-surface test; table location helper covered by new table tests |
| deleteTableColumn | document.deleteTableColumn | tables.ts | Covered with tabId support | Action-surface test; table location helper covered by new table tests |
| insertPageBreak | document.insertPageBreak | structure.ts | Covered with tabId location support | Existing action-surface test plus structure module pass |
| deletePositionedObject | document.deletePositionedObject | structure.ts | Covered with tabId support | `supports tab-scoped image replacement and positioned object deletion` |
| updateTableColumnProperties | document.updateTableColumnProperties | tables.ts | Covered | `supports table property and header row requests with tab-aware locations` |
| updateTableCellStyle | document.updateTableCellStyle | tables.ts | Existing; tab-aware table location added | Existing action-surface test; table helper covered by new table tests |
| updateTableRowStyle | document.updateTableRowStyle | tables.ts | Covered | `supports table row style requests` |
| replaceImage | document.replaceImage | images.ts | Covered with tabId support | `supports tab-scoped image replacement and positioned object deletion` |
| updateDocumentStyle | document.updateDocumentStyle | structure.ts | Covered with tabId support | Existing action-surface test plus structure module pass |
| mergeTableCells | document.mergeTableCells | tables.ts | Covered with tab-aware table location | Existing action-surface test; table helper covered by new table tests |
| unmergeTableCells | document.unmergeTableCells | tables.ts | Covered with tab-aware table location | Existing action-surface test; table helper covered by new table tests |
| createHeader | document.createHeader | structure.ts | Covered with tabId section location support | Existing action-surface test plus structure module pass |
| createFooter | document.createFooter | structure.ts | Covered with tabId section location support | Existing action-surface test plus structure module pass |
| createFootnote | document.createFootnote | structure.ts | Covered | `supports footnote, named range replacement, and section style requests` |
| replaceNamedRangeContent | document.replaceNamedRangeContent | structure.ts | Covered with tabsCriteria support | `supports footnote, named range replacement, and section style requests` |
| updateSectionStyle | document.updateSectionStyle | structure.ts | Covered with tabId range support | `supports footnote, named range replacement, and section style requests` |
| insertSectionBreak | document.insertSectionBreak | structure.ts | Covered with tabId location support | Existing request-shape test |
| deleteHeader | document.deleteHeader | structure.ts | Covered with tabId support | Existing action-surface test plus structure module pass |
| deleteFooter | document.deleteFooter | structure.ts | Covered with tabId support | Existing action-surface test plus structure module pass |
| pinTableHeaderRows | document.pinTableHeaderRows | tables.ts | Covered | `supports table property and header row requests with tab-aware locations` |
| addDocumentTab | document.addDocumentTab | tabs.ts | Covered | `supports document tab lifecycle requests` |
| deleteTab | document.deleteTab | tabs.ts | Covered | `supports document tab lifecycle requests` |
| updateDocumentTabProperties | document.updateDocumentTabProperties | tabs.ts | Covered | `supports document tab lifecycle requests` |
| insertPerson | document.insertPerson | text.ts | Covered | `supports regex/tab-scoped replacement and smart-chip insert requests` |
| updateNamedStyle | document.updateNamedStyle | formatting.ts | Covered | `supports named style update requests` |
| insertRichLink | document.insertRichLink | text.ts | Covered | `supports regex/tab-scoped replacement and smart-chip insert requests` |
| insertDate | document.insertDate | text.ts | Covered | `supports regex/tab-scoped replacement and smart-chip insert requests` |

## Documents methods

| Official method | First-class action | Module | Status | Validation |
| --- | --- | --- | --- | --- |
| documents.create | document.createBlank | documents.ts | Covered through native Docs API create; document.create remains Drive-backed for folder placement | `supports native Docs create and tab-aware get` |
| documents.get | document.get | documents.ts | Covered with `includeTabsContent` and `suggestionsViewMode` | `supports native Docs create and tab-aware get`; simple flatten test |
| documents.batchUpdate | document.batchUpdate | documents.ts | Covered as raw passthrough | Existing action-surface test and helper request-shape tests |

## Module pass log

### Tables — 2026-06-24

Official docs checked: `UpdateTableColumnPropertiesRequest`, `UpdateTableRowStyleRequest`, `PinTableHeaderRowsRequest`, plus shared `Location`/`TableCellLocation` `tabId` fields in the `documents/request` reference.

Implemented:
- `document.updateTableColumnProperties`
- `document.updateTableRowStyle`
- `document.pinTableHeaderRows`
- `tabId` on table start locations and insert-table locations

Validated with mocked request-shape tests and focused build/test commands.

### Structure / sections / headers / footers / footnotes — 2026-06-24

Official docs checked: `CreateFootnoteRequest`, `ReplaceNamedRangeContentRequest`, `UpdateSectionStyleRequest`, `InsertSectionBreakRequest`, `DeleteHeaderRequest`, and `DeleteFooterRequest` in the `documents/request` reference.

Implemented:
- `document.createFootnote`
- `document.replaceNamedRangeContent`
- `document.updateSectionStyle`

Validated with mocked request-shape tests and focused build/test commands.

### Tabs — 2026-06-24

Official docs checked: `AddDocumentTabRequest`, `DeleteTabRequest`, `UpdateDocumentTabPropertiesRequest`, and `TabProperties` (`tabId`, `title`, `index`, `parentTabId`) in the official request reference and generated API docs.

Implemented:
- `document.addDocumentTab`
- `document.deleteTab`
- `document.updateDocumentTabProperties`

Validated with mocked request-shape tests and focused build/test commands.

### Text / rich inserts — 2026-06-24

Official docs checked: `ReplaceAllTextRequest` (`searchByRegex`, `tabsCriteria`), `InsertPersonRequest`, `InsertRichLinkRequest`, `InsertDateRequest`, and `Location.tabId` in the `documents/request` reference.

Implemented:
- `document.insertPerson`
- `document.insertRichLink`
- `document.insertDate`
- `searchByRegex` and `tabIds` support on `document.replaceAllText`
- `tabId` support on `document.insertText`

Validated with mocked request-shape tests and focused build/test commands.

### Formatting / named styles — 2026-06-24

Official docs checked: `UpdateNamedStyleRequest`, `NamedStyle`, `UpdateParagraphStyleRequest`, and `Range.tabId` in the `documents/request` reference.

Implemented:
- `document.updateNamedStyle`
- `tabId` support on `document.updateParagraphStyle`

Validated with mocked request-shape tests and focused build/test commands.

### Images / positioned objects — 2026-06-24

Official docs checked: `InsertInlineImageRequest`, `ReplaceImageRequest`, `DeletePositionedObjectRequest`, `Location.tabId`, and `EndOfSegmentLocation.tabId` in the `documents/request` reference.

Implemented:
- `tabId` and `endOfSegmentLocation` support on `document.insertInlineImage`
- `tabId` support on `document.replaceImage`
- `tabId` support on `document.deletePositionedObject`

Validated with mocked request-shape tests and focused build/test commands.

### Documents / get / create / raw batch — 2026-06-24

Official docs checked: `documents.create`, `documents.get` (`includeTabsContent`, `suggestionsViewMode`), and `documents.batchUpdate` in the Docs API reference.

Implemented:
- `document.createBlank` for native Docs API creation
- `includeTabsContent` support on `document.get`
- Kept `document.batchUpdate` raw passthrough
- Kept Drive-backed `document.create` for folder placement compatibility

Validated with mocked request-shape tests and focused build/test commands.

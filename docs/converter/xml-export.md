# XML export

`biqGenerateXML(mappings, order)` in `js/biq-converter.js` turns the converter's order into the `BlindIQExport_CO` XML that BlindIQ's importer reads. This page shows the structure, what fills each element, how options and notes are filtered, and what does (and doesn't) stop an export.

## Where the XML is made

| Caller (`js/biq-converter-ui.js`) | What it does with the XML |
|---|---|
| `refresh()` | Regenerates it after every change and shows it, pretty-printed by `biqPrettyXML`, on the "BlindIQ XML" tab. |
| `downloadXML` ("Download .xml") | Runs `refresh()`, saves learned mappings and the format profile in admin mode, then downloads the XML as `BlindIQ_Import_<order number>.xml` (characters other than letters, digits, `_` and `-` become `_`). |
| "Copy XML" | Copies the same XML to the clipboard. |

Things to know about the function:

- **It changes the order it is given.** It calls `biqAssignSundryCodes` and `biqApplyCustomerDefaults` before writing, so code-less sundries get codes and the customer's defaults are filled in.
- **The file is one line.** It has no XML declaration and no whitespace between elements. Normally the only line breaks are inside `CO_Delivery_Address`. `biqPrettyXML` adds line breaks for display only.
- **Names become IDs here.** The order model holds names; each link is resolved at this point ([Mappings and catalogue](mappings-and-catalogue.md)).

## Structure

An example, pretty-printed. Every value is invented, including the IDs: an order with one roller blind and one remote.

```xml
<BlindIQExport_CO>
<CustomerOrders xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<CustomerOrderID>0</CustomerOrderID>
<CO_Customer_Link>9701</CO_Customer_Link>
<CO_Customer_Order_Number>PO12345A</CO_Customer_Order_Number>
<CO_Required_Date>2026-11-20T00:00:00</CO_Required_Date>
<CO_DeliveryAddress_Link>9702</CO_DeliveryAddress_Link>
<CO_DeliveryMethod_Link>9501</CO_DeliveryMethod_Link>
<CO_PackingType_Link>9601</CO_PackingType_Link>
<CO_Delivery_Address>1 Example Road
Sampletown
</CO_Delivery_Address>
<CO_Notes>Deliver after 8am</CO_Notes>
<CO_CustomerOperator_Link>-1</CO_CustomerOperator_Link>
</CustomerOrders>

<CustomerOrderItems xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<COI_ItemCode>a</COI_ItemCode>
<COI_Qty>1</COI_Qty>
<COI_Location>Bedroom 1</COI_Location>
<COI_Supplier_Link>1</COI_Supplier_Link>
<COI_BlindType_Link>9001</COI_BlindType_Link>
<COI_BlindRange_Link>9101</COI_BlindRange_Link>
<COI_Colour_Link>9201</COI_Colour_Link>
<COI_Width>1200</COI_Width>
<COI_Drop>1500</COI_Drop>
<COI_Fix_Link>9301</COI_Fix_Link>
<COI_Control1_Link>9401</COI_Control1_Link>
<COI_Control2_Link>9402</COI_Control2_Link>
<COI_ControlDrop>1125</COI_ControlDrop>
<COI_VariantOptions>Mech Colour=Black|Bottom Bar=Black Aluminium|</COI_VariantOptions>
<COI_VariantOptions_Display xsi:nil="true" />
<COI_Order_Notes>Fit above the tiles</COI_Order_Notes>
</CustomerOrderItems>

<CustomerOrderSundries xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<COS_ItemCode>b</COS_ItemCode>
<COS_Qty>1.000</COS_Qty>
<COS_Supplier_Link>1</COS_Supplier_Link>
<COS_SundryType_Link>9902</COS_SundryType_Link>
<COS_Sundry_Link>9901</COS_Sundry_Link>
<COS_Sundry_Notes>Demo Remote 5 Channel</COS_Sundry_Notes>
</CustomerOrderSundries>

</BlindIQExport_CO>
```

There is one `CustomerOrders` header, then one `CustomerOrderItems` per blind line and one `CustomerOrderSundries` per sundry line, in the order's own order. Each of the three carries the `xmlns:xsi` declaration. The dealer wrote "PO 12345-A", exported without the space and dash. The line's "Steel Ball Chain = No" isn't in the options because it is the sheet default.

## Element reference

### `CustomerOrders`

| Element | Filled from | When empty or unknown |
|---|---|---|
| `CustomerOrderID` | `order.orderId` | `0`; BlindIQ assigns the real ID on import |
| `CO_Customer_Link` | the customer entry's `customer` (`biqResolveCustomer`) | empty element |
| `CO_Customer_Order_Number` | `biqOrderNumberForBiq(order.orderNumber)` | empty |
| `CO_Required_Date` | `order.requiredDate` + `T00:00:00` | empty; the required date is optional and set in BlindIQ |
| `CO_DeliveryAddress_Link` | the customer entry's `address` | empty |
| `CO_DeliveryMethod_Link` | `biqResolve(mappings, 'deliveryMethods', …)` | empty |
| `CO_PackingType_Link` | `biqResolve(mappings, 'packingTypes', …)`, only when a packing type is set and known | empty, never a made-up ID |
| `CO_Delivery_Address` | `order.address`, line endings normalised, escaped, followed by a line break | `<CO_Delivery_Address />` |
| `CO_Notes` | `biqExportOrderNotes(order)` | empty |
| `CO_CustomerOperator_Link` | the customer entry's `operator` | `-1` when the customer is known but has no operator; empty when the customer is unknown |

### `CustomerOrderItems` (one per line)

| Element | Filled from | When empty or unknown |
|---|---|---|
| `COI_ItemCode`, `COI_Qty`, `COI_Location` | `code`, `qty`, `location` | empty |
| `COI_Supplier_Link` | always `1` | — |
| `COI_BlindType_Link` | `biqResolve(mappings, 'blindTypes', blindType)` | empty |
| `COI_BlindRange_Link` | `biqResolveRange` | empty |
| `COI_Colour_Link` | `biqResolveColour` | `-1` when the line has no colour; empty when a colour is given but not mapped |
| `COI_Width` | `width` | empty |
| `COI_Drop` | `drop` | `0` for valances and curtain tracks (blind type IDs 14, 27, 13, 17, 18, 20); otherwise empty |
| `COI_Fix_Link` | `biqResolve(mappings, 'fixes', fix)` | `-1` when no fix; empty when not mapped |
| `COI_Control1_Link`, `COI_Control2_Link` | `biqResolveControlScoped`, which exports the twin ID the range lists | `-1` when empty; empty when not mapped |
| `COI_ControlDrop` | `controlDrop` | `0` |
| `COI_VariantOptions` | `biqEmittedVariants` (below) | `<COI_VariantOptions />` |
| `COI_VariantOptions_Display` | always `xsi:nil="true"` | — |
| `COI_Order_Notes` | `biqExportItemNotes(mappings, order, it)` | empty |

A link is written whenever the name resolves, even when the problems list objects to it: a colour the range doesn't offer, a range that belongs to another blind type, or a retired item. Stopping those is the problems list's job.

### `CustomerOrderSundries` (one per sundry)

| Element | Filled from |
|---|---|
| `COS_ItemCode` | `code`, assigned by `biqAssignSundryCodes` when empty ([Sundry codes](#sundry-codes)) |
| `COS_Qty` | `qty` to three decimals (`1.000`) |
| `COS_Supplier_Link` | always `1` |
| `COS_SundryType_Link`, `COS_Sundry_Link` | `type` and `sundry`, the BlindIQ sundry type and sundry IDs (empty when unresolved) |
| `COS_Sundry_Notes` | `biqExportSundryNotes(mappings, order, s)`: BlindIQ's name for a resolved sundry, else the dealer's wording |

## Options: what reaches `COI_VariantOptions`

`biqEmittedVariants(mappings, it)` decides, from the line's option sheet (`biqVariantSpec`):

- the key must be on the sheet;
- the value must not be empty, and must be one of the sheet's values when the sheet lists any;
- an optional option sitting at its default is left out, because absence means the default in BlindIQ;
- a required option is always written.

When the line's blind type doesn't resolve, every non-empty option is written as it stands.

The options are written as `Key=Value`, joined by `|`, with a trailing `|` (BlindIQ's own format). A `|` inside a key or value becomes `/`.

A key that isn't on the sheet, or a value that isn't on its list, is listed by `biqDroppedVariants` (unless the value is No, None or False) and shown as a problem ("option … will NOT import"), so nothing the customer asked for is lost silently. Defaults left out aren't listed: absence means the default. The in-app import preview and the printable preview use the same two functions, so the previews always match the file.

## Escaping

`tag(name, value)` writes `<Name>value</Name>`, or `<Name />` when the value is empty. Values go through `esc`, which escapes `&`, `<` and `>`; quotes don't need escaping in element text. `esc` doesn't remove control characters, so a stray control character copied from a PDF reaches the file (see [Known gaps](#known-gaps)).

## Order number

`biqOrderNumberForBiq` removes spaces, hyphens, en dashes and em dashes and keeps slashes: "PO 12345-A" is exported as "PO12345A". BlindIQ order numbers carry no spaces or dashes and capturers re-key them that way: in 2026, 1.8% of manually captured order numbers contained a space and 0.2% a hyphen, against 5.4% with spaces on imported orders. The previews show the exported form. The download's file name uses the order number as typed.

## Sundry codes

BlindIQ's importer silently drops sundry lines without a code, according to the comment on `biqAssignSundryCodes`. So each code-less sundry continues the item sequence:

- when every item code is numeric, sundries get the next numbers, padded to the same width (items "0001"–"0004" give sundry "0005");
- otherwise they get the first letters a–z not already used.

## Notes sent to BlindIQ (TBD purchase orders)

For orders read from TBD's "Online Purchase Order" (`order.source === 'bdpo'`), the XML carries only the notes a capturer still needs. Every other source is exported with its notes as they are.

| Function | Element | Leaves out |
|---|---|---|
| `biqExportOrderNotes(order)` | `CO_Notes` | "FINAL MEASURED" and "Captured by <operator>" |
| `biqExportItemNotes(mappings, order, it)` | `COI_Order_Notes` | Note fragments (split on `' \| '`) that `biqBdpoNoteIsInfo` says BlindIQ already holds, listed below |
| `biqExportSundryNotes(mappings, order, s)` | `COS_Sundry_Notes` | The note when it is exactly the resolved sundry's BlindIQ name |

`biqBdpoNoteIsInfo` removes:

- the converter's own check notes, wherever they are (`BIQ_BDPO_RULE_NOTES`): "… (confirm stock)", "Range … taken from colour … — confirm", "… read as …", "Size in 5mm steps (…)";
- a dealer note that is only a chain length, once that length is the control drop;
- among the notes the converter wrote from TBD's options (`it._bdpoGen`) only:
  - "Joined To";
  - motor, adaptor, remote, charger and the other sundry keys (they are sundry lines, or the customer's own parts);
  - "Cassette End Cap: Full End Cap" on a double roller;
  - Stack Size, No of Runners and Tape Length (BlindIQ works these out);
  - TBD's copies of what the line already holds, compared by value: Cassette, Fabric Insert, Colour, Cassette Fix, Stack / Control, Fullness, Mech Colour, a "For Blind" naming the line's own location word for word, and any "Key: Value" equal to an option the line holds (`biqHeldVariants`).

It keeps the dealer's own line notes, anything typed into the notes box, TBD options BlindIQ has no place for (tight sizes, Float Weights, side channels…), the Out of Warranty reason, and the name of a sundry that didn't resolve.

The order itself keeps every note. The editor shows "BlindIQ gets: …" under a line whose exported notes differ, and the comparison's converter reading still sees them all. The evidence is the 109 TBD orders converted from 12 August to 14 October 2026: the capturer deleted the imported order note on all 108 that had one, 276 of 278 line notes and all 49 sundry notes. Replayed over 97 purchase orders, order notes went from 95 to 0, line notes from 133 of 446 lines to 22, and sundry notes from 54 to 1.

## What stops an export

**In the browser: nothing.** `downloadXML` always writes the file ("Always export. Unknowns stay unknown"). An unknown name becomes an empty link, never an invented ID, and the capturer finishes it in BlindIQ. The red problems list (`biqCollectProblems`) tells the capturer whether the order is import-ready. The amber warnings (`biqCollectWarnings`) are heads-ups only. See [Converter overview](overview.md#stage-5-problems-and-warnings).

**BlindIQ's importer.** It isn't in this repository; the code comments describe it:

- it converts every `*_Link` field and `CustomerOrderID` to a number (`CLng`);
- it needs a number for the packing type;
- it drops sundry lines without a code.

`biqImportSafetyScan(xml)` lists every `*_Link` or `CustomerOrderID` element that isn't an integer, but nothing in this repository calls it. Unverified: how the importer treats an empty link. The scan's comment implies it fails, while the converter's help text tells capturers to import a file with unknowns and finish them in BlindIQ.

**The server automation.** Per the comment on `biqCollectWarnings` and `CLAUDE.md`, it treats every entry of `biqCollectProblems` as blocking and ignores warnings. That is why an advisory must never be added to `biqCollectProblems`.

## The June 2026 server automation

The server automation set up in June 2026 lives outside this repository (`convert-cli.mjs`, with set-up and watcher scripts; see [Architecture](../architecture.md)). It runs the converter core in Node, without the browser. Unverified: whether it is still deployed. It depends on three things in this repository:

- `js/biq-converter.js` stays DOM-free;
- `biqCollectProblems` holds only what must block;
- `biqCollectWarnings` holds everything else.

Unverified from this repository: a code review on 12 October 2026 found that it runs only 4 of the 14 pipeline steps and reads 3 of the 9 layouts. That contradicts `CLAUDE.md`'s statement that it behaves like the browser. The review recommended retiring it. While it runs, its XML can differ from what the editor would produce for the same document.

## Companion outputs

- **`biqPrettyXML(xml)`** puts each element on its own line, with a blank line before each item and sundry, for display.
- **`biqOrderPreviewHtml(mappings, order)`** builds a standalone HTML page modelled on BlindIQ's own Online Purchase Order: From and To blocks, an order panel, the blinds table with each line's options, and the sundries. Unresolved names print in red. The editor opens it in a new window and calls `print()`, so the capturer can save it as a PDF. It uses `biqEmittedVariants` and `biqExportItemNotes`, so it shows what the XML holds.
- **The in-app import preview** (`renderPreview` in the UI module) shows the same, inside the editor.

## Changing the XML safely

- **Keep element names, order and the empty-link convention.** A link is empty when unknown, never invented, and `-1` means "none". Compare any change with a real BlindIQ export; the seed comments refer to BlindIQ exports 116888 and 20112.
- **Escape every value.** Route values through `tag()` so they are escaped.
- **Use the shared functions.** Send option changes through `biqEmittedVariants` and note filtering through `biqExport…Notes`, so the previews and the file stay identical.
- **Filter per source.** Keep per-source behaviour behind `order.source`; changing what another source exports changes every order from that dealer.
- **Test end to end.** Use the regression tests ([Testing](../testing.md)), then import a converted order into BlindIQ before releasing. Main deploys straight to production ([Environments](../environments.md), [Deployment](../deployment.md)).

## Known gaps

- `esc` doesn't remove control characters. The 12 October 2026 code review reports that BlindIQ then rejects the file.
- Sundry codes stop at "z": every sundry after the 26th letter gets "z" again.
- `biqImportSafetyScan` exists but isn't called.
- The file has no XML declaration. It imports today; noted in case the importer changes.

## Related pages

- [Converter overview](overview.md)
- [Mappings and catalogue](mappings-and-catalogue.md)
- [Converter rules](rules.md)
- [Dealer formats](dealer-formats.md)
- [Converter user interface](user-interface.md)
- [Architecture](../architecture.md)
- [Known issues and roadmap](../known-issues-and-roadmap.md)
- [Glossary](../glossary.md)

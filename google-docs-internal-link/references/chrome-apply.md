# Apply a validated plan with background Chrome control

Edit Docs only after the deterministic validator reports `PASS`. Read-only
browser discovery and extraction may run before planning.

## Required work profile

1. With `cua_repl`, first call `await cua.getState()` alone and read the returned
   documentation and browser inventory.
2. Select the exact returned browser ID with `await cua.getBrowser({id})` and
   read its browser API documentation completely. Use the extension's tab,
   browser, and content export controls. A separately installed
   `chrome:control-chrome` skill is not required for this route.
3. Select exactly one Chrome extension browser. If
   `GOOGLE_DOCS_INTERNAL_LINKER_CHROME_PROFILE` is configured in the caller
   project's environment, match its `profileName` or legacy
   `metadata.profileName` exactly. Otherwise use the only authenticated work
   Chrome extension profile. Stop if the choice is ambiguous.
4. Obtain that browser by its exact returned ID. Follow the current runtime
   documentation and do not use a generic browser selector across profiles.

Never use native desktop control, `sky`, AppleScript, or a replica profile.
The `cua_repl` browser extension route is supported. If the configured work
profile is absent, report the missing browser connection.

Name the browser session, inspect `workChrome.user.openTabs()`, and claim the
exact returned tab for the target Doc. If no matching tab exists, create a new
background tab and navigate it to the supplied Doc URL. Do not activate, raise,
or focus a visible tab. Mark the edited tab as the deliverable.

## Operating rules

- Edit the original Google Doc only.
- Do not create a replacement Doc or rewrite its protected original body.
- Add or update visible text only inside the generated bottom review section.
- A body placement counts as applied only when the exact anchor has both the
  planned link metadata and visible Google Docs hyperlink styling. Do not leave
  a new link black and non-underlined merely because its `textStyle.link` value
  is present.
- When a direct Google Docs `batchUpdate` is used, set `link`, `underline: true`,
  and the foreground color used by an existing visible body link in the same
  Doc. If the Doc has no visible body-link exemplar, use Google Docs link blue
  `rgbColor: { red: 0.09803922, green: 0.40392157, blue: 0.8235294 }`. Preserve
  every other resolved text-style field, including font, size, weight, italics,
  and baseline offset.
- Do not ask for a separate pre-application approval gate.
- Take a fresh DOM snapshot after every action that can change the page.
- Skip a placement whenever its exact live location cannot be proven.

## Resolve the live Find occurrence

Google Docs Find searches the entire document case-insensitively. The planner's
`locator.match_index` counts case-sensitive matches only inside the extracted
planner text. Never use `locator.match_index` directly unless the planner input
is proven to equal the entire Google Doc.

Before applying each link:

1. Read fresh Drive semantic structure for all visible text, including tables,
   planning content, metadata, headings, and body copy.
2. Identify the exact target paragraph with the anchor, prefix, suffix, and
   paragraph fingerprint.
3. Count every case-insensitive whole-Doc occurrence through the target and
   store the one-based result as `live_find_index`.
4. Skip the placement if the exact occurrence cannot be derived.

## Apply one link

For every validated placement:

1. Confirm the Doc is editable.
2. Check that the canonical target URL is not already linked in the Doc.
3. Open Google Docs Find in the background tab.
4. Read the occurrence count from the Find dialog itself. Do not use unrelated
   page text such as another `x of y` indicator.
5. Move to `live_find_index`, taking a fresh DOM snapshot after each move.
6. Confirm the visible prefix, anchor, suffix, and paragraph context.
7. Close Find and confirm the selected paragraph style is `Normal text`.
8. Skip Title, Subtitle, Heading, metadata, and planning content.
9. Select only the exact anchor characters.
10. Use Insert link, put the planned target URL in the Link field, and apply it.
11. Re-read the DOM and confirm the link dialog closed, the exact anchor is
    linked, and visible text did not change.
12. Mark the placement `applied` only after verification succeeds.

For repeated anchors, use `live_find_index` together with the prefix, suffix,
paragraph fingerprint, and visible context. Do not infer from the anchor alone.

For batches, process Docs in input order and preserve the one-target-per-Doc
rule across both existing and newly applied body links.

## Append the review section

After all body placements have been verified, maintain exactly one generated
section at the bottom of the Doc.

1. Build its entries from fresh post-application verification, not from the
   unverified plan.
2. If the Doc already ends with exactly one Heading 2 named `Links added for
   review`, parse its existing entries. Retain an entry only when its exact
   anchor-target link still exists in the protected body.
3. Merge retained entries with the current run's audited `applied` items.
   Preserve prior order, add current items in plan order, and deduplicate exact
   normalized anchor-target pairs.
4. If the section does not exist, move to the absolute end of the Doc, insert a
   blank paragraph, and add `Links added for review` as Heading 2.
5. Replace only the generated list beneath that heading. Do not append a second
   review section on a rerun.
6. Format each entry as a bullet in this exact visible form:

   `anchor text → https://www.canva.com/vi_vn/target/`

7. Link the visible target URL to itself. These display-only footer links are
   excluded from body-link uniqueness and planning checks.
8. If there are no retained or newly applied entries, add the normal-text line
   `No links were added.` instead of a bullet list.
9. Confirm the review section is the final section and no original body content
   follows it.

If the heading is duplicated, ambiguous, or not the final section, do not
delete content or guess. Stop and report the ambiguity to the user.

## Verification

After each Doc:

1. Confirm Google Docs reports the document saved to Drive, then refresh.
2. Read fresh Drive semantic structure.
3. Prove the protected original body text is byte-for-byte unchanged.
4. Prove each applied body anchor points to the exact target and each target
   appears at most once in the protected body.
5. Prove exactly one `Links added for review` section is at the bottom and every
   row maps to a verified skill-managed body link.
6. Prove every skill-managed body link is visibly underlined and uses the Doc's
   visible link color, in addition to pointing to the exact planned URL.
7. Record every planned placement and the review-section status in the audit.

If the current run created a misplaced link, repair only that run-created link
using exact fresh ranges and the required revision ID, then repeat the complete
audit. Never remove or change a pre-existing link.

Build the final response's `Links added for review` list from the verified rows
in the appended Doc section.

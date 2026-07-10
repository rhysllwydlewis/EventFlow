# Homepage and Media Centre hardening

This document records the behaviour introduced by PR #1321 and the minimum regression checks for future changes to the authenticated dashboard surfaces.

## Homepage Manager guarantees

- The editor uses one column at viewport widths of 1180px and below.
- Hero-form edits produce an explicit unsaved state.
- A homepage cannot be published while the selected form contains unsaved changes.
- Switching homepage versions, refreshing, changing hero media or leaving the page warns before discarding edits.
- Homepage tab names can be changed independently using the existing version API, after current hero edits are saved or reset.
- Save, publish and media mutations expose a busy state and suppress duplicate submissions.
- The category editor behaves as a modal dialog, traps keyboard focus, closes with Escape and restores focus.

## Media Centre guarantees

- Pexels media and uploaded media are available from the same admin surface.
- Uploaded files use the existing authenticated and CSRF-protected collage-media endpoints.
- The interface follows the backend limits of 10 files per request and 10 MB per file.
- Uploaded media can be assigned to Homepage 1, 2 or 3 as hero, collage or general media.
- Assignment records keep `selectedUploads`, the hero order and the legacy `uploadGallery` contract aligned.
- Homepage assignment badges show where an uploaded file is currently used.
- A physical upload cannot be deleted while it remains assigned to a homepage, preventing broken media references.

## V3 playback compatibility

The V3 player historically consumed uploaded videos from `collageWidget.uploadGallery`, while newer admin data stores uploaded assignments in `mediaLibrary.selectedUploads`. The V3 page now normalises the backend-resolved selected media into the existing playlist contract before the player reads the settings response, preserving the saved hero order.

## Manual QA checklist

1. Open `/admin-homepage` at desktop, tablet and mobile widths.
2. Edit a hero setting and confirm that publish is disabled until the form is saved or reset.
3. Attempt to switch homepage versions with unsaved changes and test both cancel and discard paths.
4. Rename each homepage and confirm the new names appear in Homepage Manager and Media Centre.
5. Upload one photo and multiple videos from `/admin-media`.
6. Assign uploaded media to each homepage and test hero, collage and general placements.
7. Preview Homepage 2 and Homepage 3 before publishing either version.
8. Confirm a Homepage 3 uploaded-video queue plays every configured video and loops in the saved order.
9. Test category-editor keyboard focus, Escape closing and focus restoration.
10. Confirm failed uploads and API requests display an error without leaving controls permanently disabled.
11. Attempt to delete an assigned upload and confirm the interface requires its homepage assignments to be removed first.

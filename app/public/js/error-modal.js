// =============================================================================
// error-modal.js
// Shared #errorModal/#overlay helpers (see partials/error.ejs). Used by both
// the board editor and analysis pages.
// =============================================================================

function showError(message) {
  $('#errorMessage').text(message);
  $('#overlay').removeClass('hidden');
  $('#errorModal').removeClass('hidden');
}

function closeError() {
  $('#overlay').addClass('hidden');
  $('#errorModal').addClass('hidden');
}

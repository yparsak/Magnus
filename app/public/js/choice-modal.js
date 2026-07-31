// =============================================================================
// choice-modal.js
// Generic "pick one of several options" popup. Built on the same
// #overlay/.error-modal visual pattern already used by error-modal.js (see
// partials/error.ejs) so popups look consistent across the app, but this one
// isn't tied to any single feature -- callers supply a title, a list of
// { label, value } options, and a callback, and this module owns the
// DOM/markup and tears itself down once a choice is made or the popup is
// dismissed. Reused today for "which variation should ArrowRight follow?" on
// the analysis page; equally usable anywhere else a "choose one" popup is
// needed later.
//
// Usage:
//   ChoiceModal.prompt('Choose a line', [
//     { label: 'Main line: 12. Nf3', value: nodeA },
//     { label: 'Variation: 12. e4', value: nodeB }
//   ], function (chosenValue) { ... });
// =============================================================================

(function () {
  'use strict';

  function prompt(title, options, onChoose) {
    var $overlay = $('<div>', { class: 'overlay choice-modal-overlay' });
    var $modal = $('<div>', { class: 'error-modal choice-modal' });
    $modal.append($('<h2>', { text: title }));

    var $options = $('<div>', { class: 'choice-modal-options' });
    options.forEach(function (option) {
      var $button = $('<button>', { class: 'choice-modal-option', text: option.label });
      $button.on('click', function () {
        close();
        onChoose(option.value);
      });
      $options.append($button);
    });
    $modal.append($options);

    function close() {
      $overlay.remove();
      $modal.remove();
      $(document).off('keydown.choiceModal');
    }

    $overlay.on('click', close);
    $(document).on('keydown.choiceModal', function (e) {
      if (e.key === 'Escape') {
        close();
      }
    });

    $('body').append($overlay).append($modal);
  }

  window.ChoiceModal = { prompt: prompt };
})();

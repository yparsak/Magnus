// =============================================================================
// choice-modal.js
// Generic "pick one of several options" popup. Built on the same
// #overlay/.error-modal visual pattern already used by error-modal.js (see
// partials/error.ejs) so popups look consistent across the app, but this one
// isn't tied to any single feature -- callers supply a title, a list of
// { label, value } options, and a callback, and this module owns the
// DOM/markup and tears itself down once a choice is made or the popup is
// dismissed. Reused today for "which variation should ArrowRight follow?" on
// the analysis page and "which side do you want?" on the play page; equally
// usable anywhere else a "choose one" popup is needed later.
//
// Usage:
//   ChoiceModal.prompt('Choose a line', [
//     { label: 'Main line: 12. Nf3', value: nodeA },
//     { label: 'Variation: 12. e4', value: nodeB }
//   ], function (chosenValue) { ... });
//
// An options object may follow the callback. `closable: true` adds an X and
// makes Escape/overlay-click meaningful; `onDismiss` is then called when the
// popup is closed without a choice. Options carrying an `image` render it
// above the label as a picture button (see the king pickers on the play
// page) instead of a plain text row:
//
//   ChoiceModal.prompt('Choose your side', [
//     { label: 'White', value: 'w', image: '/imgs/wK.png' },
//     { label: 'Black', value: 'b', image: '/imgs/bK.png' }
//   ], onChoose, { closable: true, onDismiss: goHome });
// =============================================================================

(function () {
  'use strict';

  function prompt(title, options, onChoose, settings) {
    var config = settings || {};
    var chosen = false;

    var $overlay = $('<div>', { class: 'overlay choice-modal-overlay' });
    var $modal = $('<div>', { class: 'error-modal choice-modal' });

    var $header = $('<div>', { class: 'choice-modal-header' });
    $header.append($('<h2>', { text: title }));
    if (config.closable) {
      var $close = $('<button>', {
        type: 'button',
        class: 'choice-modal-close',
        title: 'Cancel',
        'aria-label': 'Cancel',
        html: '&times;'
      });
      $close.on('click', close);
      $header.append($close);
    }
    $modal.append($header);

    var hasImages = options.some(function (option) { return Boolean(option.image); });
    var $options = $('<div>', {
      class: 'choice-modal-options' + (hasImages ? ' choice-modal-options-images' : '')
    });

    options.forEach(function (option) {
      var $button = $('<button>', { type: 'button', class: 'choice-modal-option' });
      if (option.image) {
        $button.addClass('choice-modal-option-image');
        $button.append($('<img>', { src: option.image, alt: option.label }));
        $button.append($('<span>', { text: option.label }));
      } else {
        $button.text(option.label);
      }
      $button.on('click', function () {
        chosen = true;
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
      // Only a dismissal -- not a pick -- should fire onDismiss, so a
      // caller can treat it as "cancel" without having to tell the two
      // apart itself.
      if (!chosen && typeof config.onDismiss === 'function') {
        config.onDismiss();
      }
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

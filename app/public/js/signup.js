$(function () {
  const $username = $('#username');
  const $availability = $('#username-availability');
  const $submit = $('#signup-submit');

  const USERNAME_MIN_LENGTH = 3;
  const USERNAME_MAX_LENGTH = 50;

  let debounceTimer = null;
  let checkInFlight = false;

  function setAvailability(text, color) {
    $availability.text(text).css('color', color || '');
  }

  function checkUsernameAvailability() {
    const username = $username.val().trim();

    if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
      setAvailability('', '');
      return;
    }

    checkInFlight = true;
    $submit.prop('disabled', true);

    fetch('/signup/check-username?username=' + encodeURIComponent(username))
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        if (data.available) {
          setAvailability('Username is available', '#5cb85c');
          $submit.prop('disabled', false);
        } else {
          setAvailability('Username is already taken', '#d9534f');
          $submit.prop('disabled', true);
        }
      })
      .catch(function () {
        // Fail open -- the server re-validates on submit regardless.
        setAvailability('', '');
        $submit.prop('disabled', false);
      })
      .finally(function () {
        checkInFlight = false;
      });
  }

  $username.on('blur', checkUsernameAvailability);

  $username.on('input', function () {
    clearTimeout(debounceTimer);
    if (!checkInFlight) {
      $submit.prop('disabled', false);
    }
    debounceTimer = setTimeout(checkUsernameAvailability, 400);
  });
});

$(function () {
  const $username = $('#username');
  const $availability = $('#username-availability');
  const $password = $('#password');
  const $passwordHint = $('#password-hint');
  const $submit = $('#signup-submit');

  const USERNAME_MIN_LENGTH = 3;
  const USERNAME_MAX_LENGTH = 50;
  const PASSWORD_MIN_LENGTH = 8;
  const PASSWORD_SPECIAL_CHARS = '!@#$%^&*()_+';
  const PASSWORD_SPECIAL_CHARS_REGEX = /[!@#$%^&*()_+]/;

  let debounceTimer = null;
  let checkInFlight = false;
  let usernameOk = true;
  let passwordOk = true;

  function setAvailability(text, color) {
    $availability.text(text).css('color', color || '');
  }

  function setPasswordHint(text, color) {
    $passwordHint.text(text).css('color', color || '');
  }

  // $submit stays disabled unless the username is available AND the
  // password meets the format policy (mirrors check_password() in
  // scripts/install.sh -- this is a UX nicety only, the server re-validates
  // both on submit regardless).
  function updateSubmitState() {
    $submit.prop('disabled', checkInFlight || !(usernameOk && passwordOk));
  }

  function isPasswordValid(password) {
    return password.length > PASSWORD_MIN_LENGTH
      && /[0-9]/.test(password)
      && /[A-Z]/.test(password)
      && PASSWORD_SPECIAL_CHARS_REGEX.test(password);
  }

  function checkPasswordFormat() {
    const password = $password.val();

    if (!password) {
      setPasswordHint('', '');
      passwordOk = true;
      updateSubmitState();
      return;
    }

    if (isPasswordValid(password)) {
      setPasswordHint('Password meets requirements', '#5cb85c');
      passwordOk = true;
    } else {
      setPasswordHint(
        'Password must be more than ' + PASSWORD_MIN_LENGTH + ' characters and include a number, ' +
          'an uppercase letter, and one of ' + PASSWORD_SPECIAL_CHARS,
        '#d9534f'
      );
      passwordOk = false;
    }
    updateSubmitState();
  }

  function checkUsernameAvailability() {
    const username = $username.val().trim();

    if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
      setAvailability('', '');
      return;
    }

    checkInFlight = true;
    updateSubmitState();

    fetch('/signup/check-username?username=' + encodeURIComponent(username))
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        if (data.available) {
          setAvailability('Username is available', '#5cb85c');
          usernameOk = true;
        } else {
          setAvailability('Username is already taken', '#d9534f');
          usernameOk = false;
        }
      })
      .catch(function () {
        // Fail open -- the server re-validates on submit regardless.
        setAvailability('', '');
        usernameOk = true;
      })
      .finally(function () {
        checkInFlight = false;
        updateSubmitState();
      });
  }

  $username.on('blur', checkUsernameAvailability);

  $username.on('input', function () {
    clearTimeout(debounceTimer);
    if (!checkInFlight) {
      usernameOk = true;
      updateSubmitState();
    }
    debounceTimer = setTimeout(checkUsernameAvailability, 400);
  });

  $password.on('input', checkPasswordFormat);
});

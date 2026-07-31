'use strict';

function renderPage(res, template, page, data =  {}, options = {}) {
  const {
    title = 'Magnus',
    mode  = null
  } = options;

  res.render(template, {
    ...data,
    content: `pages/${page}`,
    title,
    mode
  });
}

module.exports = { renderPage };


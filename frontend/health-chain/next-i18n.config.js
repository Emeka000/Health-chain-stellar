const path = require('path');

module.exports = {
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'fr'],
    localePath: path.resolve('./public/locales'),
  },
  ns: ['common', 'forms', 'orders', 'dispatch', 'verification', 'errors'],
  defaultNS: 'common',
  nsSeparator: ':',
  keySeparator: '.',
};

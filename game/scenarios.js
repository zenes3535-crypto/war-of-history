// Senaryolar: hangi bugünkü ülke kimin elinde, başlangıç tarihi, ittifaklar, savaşlar.
// Ülke adları world-atlas (Natural Earth) adlarıdır.

// Bağımlı topraklar: her senaryoda egemen devlete katılır
const DEPENDENCIES = {
  'United States of America': ['Puerto Rico', 'Guam', 'U.S. Virgin Is.', 'American Samoa', 'N. Mariana Is.'],
  'United Kingdom': ['Falkland Is.', 'Cayman Is.', 'Bermuda', 'British Virgin Is.', 'Turks and Caicos Is.', 'Montserrat', 'Anguilla', 'Saint Helena', 'Pitcairn Is.', 'S. Geo. and the Is.', 'Br. Indian Ocean Ter.', 'Jersey', 'Guernsey', 'Isle of Man'],
  'France': ['St. Pierre and Miquelon', 'Wallis and Futuna Is.', 'St-Martin', 'St-Barthélemy', 'Fr. Polynesia', 'New Caledonia', 'Fr. S. Antarctic Lands'],
  'Denmark': ['Greenland', 'Faeroe Is.'],
  'Finland': ['Åland'],
  'Netherlands': ['Aruba', 'Curaçao', 'Sint Maarten'],
  'China': ['Macao', 'Hong Kong'],
  'Australia': ['Indian Ocean Ter.', 'Heard I. and McDonald Is.', 'Norfolk Island', 'Ashmore and Cartier Is.'],
  'New Zealand': ['Niue', 'Cook Is.'],
  'India': ['Siachen Glacier'],
};

const SCENARIOS = {
  '2026': {
    name: 'Modern Dünya (2026)',
    date: [2026, 1, 1],
    // her ülke kendi devleti; gruplar yalnızca birleşme gerekenler
    groups: [],
    alliances: [
      { name: 'NATO', members: ['United States of America', 'Canada', 'United Kingdom', 'France', 'Germany', 'Italy', 'Spain', 'Portugal', 'Netherlands', 'Belgium', 'Luxembourg', 'Denmark', 'Norway', 'Iceland', 'Poland', 'Czechia', 'Slovakia', 'Hungary', 'Romania', 'Bulgaria', 'Greece', 'Turkey', 'Albania', 'Croatia', 'Slovenia', 'Montenegro', 'Macedonia', 'Estonia', 'Latvia', 'Lithuania', 'Finland', 'Sweden'] },
      { name: 'KGAÖ', members: ['Russia', 'Belarus', 'Kazakhstan', 'Kyrgyzstan', 'Tajikistan', 'Armenia'] },
    ],
    wars: [],
  },
  '1939': {
    name: 'İkinci Dünya Savaşı (1939)',
    date: [1939, 9, 1],
    groups: [
      { key: 'Germany', name: 'Alman Reich', iso: 'de', members: ['Germany', 'Austria', 'Czechia'] },
      { key: 'Italy', name: 'İtalya Krallığı', iso: 'it', members: ['Italy', 'Libya', 'Albania', 'Eritrea', 'Ethiopia', 'Somalia', 'Somaliland'] },
      { key: 'United Kingdom', name: 'Britanya İmparatorluğu', iso: 'gb', members: ['United Kingdom', 'India', 'Pakistan', 'Bangladesh', 'Myanmar', 'Sri Lanka', 'Sudan', 'S. Sudan', 'Kenya', 'Uganda', 'Tanzania', 'Nigeria', 'Ghana', 'Sierra Leone', 'Gambia', 'Malaysia', 'Singapore', 'Brunei', 'Jordan', 'Israel', 'Palestine', 'Cyprus', 'N. Cyprus', 'Malta', 'Botswana', 'Zimbabwe', 'Zambia', 'Malawi', 'Lesotho', 'eSwatini', 'Belize', 'Guyana', 'Jamaica', 'Bahamas', 'Trinidad and Tobago', 'Kuwait', 'Qatar', 'United Arab Emirates', 'Bahrain', 'Papua New Guinea', 'Solomon Is.', 'Fiji'] },
      { key: 'France', name: 'Fransa', iso: 'fr', members: ['France', 'Algeria', 'Morocco', 'Tunisia', 'Mauritania', 'Senegal', 'Mali', 'Guinea', "Côte d'Ivoire", 'Burkina Faso', 'Niger', 'Benin', 'Togo', 'Chad', 'Central African Rep.', 'Congo', 'Gabon', 'Cameroon', 'Madagascar', 'Djibouti', 'Vietnam', 'Laos', 'Cambodia', 'Syria', 'Lebanon', 'Comoros', 'Vanuatu'] },
      { key: 'Russia', name: 'Sovyetler Birliği', iso: 'ru', members: ['Russia', 'Ukraine', 'Belarus', 'Kazakhstan', 'Uzbekistan', 'Turkmenistan', 'Kyrgyzstan', 'Tajikistan', 'Georgia', 'Armenia', 'Azerbaijan'] },
      { key: 'Japan', name: 'Japon İmparatorluğu', iso: 'jp', members: ['Japan', 'North Korea', 'South Korea', 'Taiwan'] },
      { key: 'Netherlands', name: 'Hollanda', iso: 'nl', members: ['Netherlands', 'Indonesia', 'Suriname', 'Timor-Leste'] },
      { key: 'Belgium', name: 'Belçika', iso: 'be', members: ['Belgium', 'Dem. Rep. Congo', 'Rwanda', 'Burundi'] },
      { key: 'Portugal', name: 'Portekiz', iso: 'pt', members: ['Portugal', 'Angola', 'Mozambique', 'Guinea-Bissau'] },
      { key: 'Spain', name: 'İspanya', iso: 'es', members: ['Spain', 'W. Sahara', 'Eq. Guinea'] },
      { key: 'Serbia', name: 'Yugoslavya', iso: 'rs', members: ['Serbia', 'Croatia', 'Slovenia', 'Bosnia and Herz.', 'Montenegro', 'Macedonia', 'Kosovo'] },
      { key: 'Romania', name: 'Romanya', iso: 'ro', members: ['Romania', 'Moldova'] },
      { key: 'United States of America', name: 'Amerika Birleşik Devletleri', iso: 'us', members: ['United States of America', 'Philippines'] },
      { key: 'South Africa', name: 'Güney Afrika Birliği', iso: 'za', members: ['South Africa', 'Namibia'] },
      { key: 'Turkey', name: 'Türkiye', iso: 'tr', members: ['Turkey'] },
      { key: 'Iraq', name: 'Irak Krallığı', iso: 'iq', members: ['Iraq'] },
      { key: 'Egypt', name: 'Mısır Krallığı', iso: 'eg', members: ['Egypt'] },
      { key: 'Iran', name: 'İran', iso: 'ir', members: ['Iran'] },
      { key: 'Thailand', name: 'Siyam', iso: 'th', members: ['Thailand'] },
      { key: 'Slovakia', name: 'Slovakya', iso: 'sk', members: ['Slovakia'] },
    ],
    alliances: [
      { name: 'Mihver', members: ['Germany', 'Italy', 'Japan'] },
      { name: 'Müttefikler', members: ['United Kingdom', 'France', 'Poland', 'Australia', 'New Zealand', 'Canada', 'South Africa'] },
    ],
    wars: [
      { attackers: ['Germany'], defenders: ['Poland'] },
      { attackers: ['Japan'], defenders: ['China'] },
    ],
  },
  '1914': {
    name: 'Birinci Dünya Savaşı (1914)',
    date: [1914, 7, 28],
    groups: [
      { key: 'Turkey', name: 'Osmanlı İmparatorluğu', iso: 'tr', members: ['Turkey', 'Syria', 'Iraq', 'Lebanon', 'Israel', 'Palestine', 'Jordan', 'Yemen'] },
      { key: 'Russia', name: 'Rus İmparatorluğu', iso: 'ru', members: ['Russia', 'Finland', 'Estonia', 'Latvia', 'Lithuania', 'Poland', 'Belarus', 'Ukraine', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Uzbekistan', 'Turkmenistan', 'Kyrgyzstan', 'Tajikistan'] },
      { key: 'Germany', name: 'Alman İmparatorluğu', iso: 'de', members: ['Germany', 'Namibia', 'Cameroon', 'Togo', 'Tanzania', 'Rwanda', 'Burundi', 'Papua New Guinea'] },
      { key: 'Austria', name: 'Avusturya-Macaristan', iso: 'at', members: ['Austria', 'Hungary', 'Czechia', 'Slovakia', 'Slovenia', 'Croatia', 'Bosnia and Herz.'] },
      { key: 'United Kingdom', name: 'Britanya İmparatorluğu', iso: 'gb', members: ['United Kingdom', 'Ireland', 'India', 'Pakistan', 'Bangladesh', 'Myanmar', 'Sri Lanka', 'Egypt', 'Sudan', 'S. Sudan', 'Kenya', 'Uganda', 'Nigeria', 'Ghana', 'Sierra Leone', 'Gambia', 'Malaysia', 'Singapore', 'Brunei', 'Cyprus', 'N. Cyprus', 'Malta', 'Botswana', 'Zimbabwe', 'Zambia', 'Malawi', 'Lesotho', 'eSwatini', 'Somaliland', 'Belize', 'Guyana', 'Jamaica', 'Bahamas', 'Trinidad and Tobago', 'Kuwait', 'Qatar', 'United Arab Emirates', 'Bahrain', 'Solomon Is.', 'Fiji'] },
      { key: 'France', name: 'Fransa', iso: 'fr', members: ['France', 'Algeria', 'Tunisia', 'Morocco', 'Mauritania', 'Senegal', 'Mali', 'Guinea', "Côte d'Ivoire", 'Burkina Faso', 'Niger', 'Benin', 'Chad', 'Central African Rep.', 'Congo', 'Gabon', 'Madagascar', 'Djibouti', 'Vietnam', 'Laos', 'Cambodia', 'Comoros', 'Vanuatu'] },
      { key: 'Italy', name: 'İtalya Krallığı', iso: 'it', members: ['Italy', 'Libya', 'Eritrea', 'Somalia'] },
      { key: 'Japan', name: 'Japon İmparatorluğu', iso: 'jp', members: ['Japan', 'North Korea', 'South Korea', 'Taiwan'] },
      { key: 'Belgium', name: 'Belçika', iso: 'be', members: ['Belgium', 'Dem. Rep. Congo'] },
      { key: 'Netherlands', name: 'Hollanda', iso: 'nl', members: ['Netherlands', 'Indonesia', 'Suriname'] },
      { key: 'Portugal', name: 'Portekiz', iso: 'pt', members: ['Portugal', 'Angola', 'Mozambique', 'Guinea-Bissau', 'Timor-Leste'] },
      { key: 'Spain', name: 'İspanya', iso: 'es', members: ['Spain', 'W. Sahara', 'Eq. Guinea'] },
      { key: 'Serbia', name: 'Sırbistan Krallığı', iso: 'rs', members: ['Serbia', 'Kosovo', 'Macedonia'] },
      { key: 'United States of America', name: 'Amerika Birleşik Devletleri', iso: 'us', members: ['United States of America', 'Philippines'] },
      { key: 'Denmark', name: 'Danimarka', iso: 'dk', members: ['Denmark', 'Iceland'] },
      { key: 'South Africa', name: 'Güney Afrika Birliği', iso: 'za', members: ['South Africa'] },
      { key: 'Saudi Arabia', name: 'Necd Emirliği', iso: 'sa', members: ['Saudi Arabia'] },
      { key: 'Iran', name: 'İran (Kaçar)', iso: 'ir', members: ['Iran'] },
      { key: 'Thailand', name: 'Siyam', iso: 'th', members: ['Thailand'] },
      { key: 'China', name: 'Çin Cumhuriyeti', iso: 'cn', members: ['China', 'Mongolia'] },
    ],
    alliances: [
      { name: 'İtilaf Devletleri', members: ['France', 'Russia', 'United Kingdom', 'Serbia', 'Belgium', 'Japan', 'Australia', 'Canada', 'New Zealand', 'South Africa', 'Montenegro'] },
      { name: 'İttifak Devletleri', members: ['Germany', 'Austria'] },
    ],
    wars: [
      { attackers: ['Austria'], defenders: ['Serbia'] },
    ],
  },
};

module.exports = { SCENARIOS, DEPENDENCIES };

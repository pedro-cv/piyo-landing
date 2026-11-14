import micros from '@/data/micros.json';
import site from '@/data/site.json';

export { micros };

/** FAQ shown on the page and emitted as FAQPage JSON-LD. The download answer follows site.playStore.url. */
export const faqItems = micros.faq.map((f) =>
  f.q.startsWith('¿Dónde descargo') && site.playStore.url
    ? { q: f.q, a: 'piyo es para Android y se descarga gratis desde Google Play.' }
    : f,
);

export const faqJsonLd = {
  '@type': 'FAQPage',
  inLanguage: 'es-BO',
  mainEntity: faqItems.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
};

/** The app itself. No ratings: we only publish what is true. */
export const appJsonLd = (home: string) => ({
  '@type': 'MobileApplication',
  '@id': `${home}#app`,
  name: site.name,
  description: site.description,
  operatingSystem: 'Android',
  applicationCategory: 'TravelApplication',
  inLanguage: 'es-BO',
  isAccessibleForFree: true,
  license: 'https://www.gnu.org/licenses/gpl-3.0.html',
  url: site.playStore.url || home,
  installUrl: site.playStore.url || undefined,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'BOB' },
  areaServed: { '@type': 'City', name: 'Santa Cruz de la Sierra', containedInPlace: { '@type': 'Country', name: 'Bolivia' } },
  publisher: { '@id': `${home}#org` },
});

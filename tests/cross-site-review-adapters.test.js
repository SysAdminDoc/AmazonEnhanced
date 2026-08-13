const test = require('node:test');
const assert = require('node:assert/strict');
const adapters = require('../cross-site-review-adapters.js');
const kernel = require('../review-score-kernel.js');
const fixtures = require('./fixtures/cross-site-reviews.json');

class FixtureElement {
  constructor({ attributes = {}, text = '', children = {}, id = '' } = {}) {
    this.attributes = attributes;
    this.textContent = text;
    this.children = new Map(Object.entries(children));
    this.id = id;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  querySelector(selector) {
    return this.children.get(selector) || null;
  }
}

function createReview(fixture, index, rating) {
  const selectors = fixture.selectors;
  const idAttribute = selectors.review === '[data-review-id]' ? 'data-review-id' : 'data-reviewid';
  return new FixtureElement({
    attributes: { [idAttribute]: `${fixture.id}-review-${index}` },
    text: `Verified purchase Fixture review ${index}`,
    children: {
      [selectors.title]: new FixtureElement({ text: `Fixture title ${index}` }),
      [selectors.body]: new FixtureElement({ text: `Privacy-safe fixture body ${index}` }),
      [selectors.rating]: new FixtureElement({
        attributes: { 'aria-label': `${rating} out of 5 stars` },
        text: `${rating} out of 5 stars`
      }),
      [selectors.author]: new FixtureElement({ text: `Fixture author ${index}` })
    }
  });
}

function createDocument(fixture) {
  let reviews = [];
  const count = new FixtureElement({ text: '1.2K reviews' });
  const section = new FixtureElement();
  return {
    insertReviews(next) { reviews = next; },
    querySelectorAll(selector) {
      return selector === fixture.selectors.review ? reviews : [];
    },
    querySelector(selector) {
      if (selector === fixture.selectors.count) return count;
      if (selector === fixture.selectors.section) return section;
      return null;
    }
  };
}

test('matches only fixture-backed product routes and supported retailer hosts', () => {
  assert.equal(fixtures.sites.length, 4);
  for (const fixture of fixtures.sites) {
    for (const pathname of fixture.productPaths) {
      assert.equal(adapters.findSite(fixture.hostname, pathname)?.id, fixture.id, `${fixture.id}: ${pathname}`);
      assert.equal(
        adapters.routeKey({ hostname: fixture.hostname, pathname }),
        `${fixture.id}:${pathname}`
      );
    }
    assert.equal(adapters.findSite(fixture.hostname, fixture.nonProductPath), null, fixture.id);
    assert.equal(adapters.findSite(`${fixture.hostname}.example.com`, fixture.productPaths[0]), null, fixture.id);
  }
  assert.equal(
    adapters.findSite('www.bestbuy.com', '/product/current-format/sku/7654321')?.id,
    'bestbuy'
  );
});

test('uses bounded stable hooks instead of wildcard test IDs or generated classes', () => {
  for (const site of adapters.SITE_CONFIGS) {
    for (const key of [
      'reviewSelectors', 'titleSelectors', 'bodySelectors', 'ratingSelectors',
      'reviewCountSelectors', 'reviewSectionSelectors', 'authorSelectors'
    ]) {
      for (const selector of site[key]) {
        assert.doesNotMatch(selector, /\*=|\[class[*^$]?=|:nth-/i, `${site.id}.${key}: ${selector}`);
      }
    }
  }
});

test('collects delayed visible reviews from every privacy-safe retailer fixture', () => {
  for (const fixture of fixtures.sites) {
    const site = adapters.SITE_CONFIGS.find(candidate => candidate.id === fixture.id);
    const documentLike = createDocument(fixture);
    assert.deepEqual(adapters.collectReviews(documentLike, site, kernel), [], `${fixture.id} initial`);

    documentLike.insertReviews([
      createReview(fixture, 1, 5),
      createReview(fixture, 2, 2)
    ]);
    const reviews = adapters.collectReviews(documentLike, site, kernel);
    assert.equal(reviews.length, 2, fixture.id);
    assert.deepEqual(reviews.map(review => review.rating), [5, 2], fixture.id);
    assert.ok(reviews.every(review => review.verified), fixture.id);
    assert.ok(reviews.every(review => review.author.startsWith('Fixture author')), fixture.id);
    assert.equal(adapters.totalReviewCount(documentLike, site), 1200, fixture.id);
    assert.ok(kernel.scoreReviews(reviews, adapters.totalReviewCount(documentLike, site)));
  }
});

test('normalizes compact and ordinary review counts', () => {
  assert.equal(adapters.parseReviewCount('1,234 reviews'), 1234);
  assert.equal(adapters.parseReviewCount('1.2K ratings'), 1200);
  assert.equal(adapters.parseReviewCount('2M reviews'), 2000000);
  assert.equal(adapters.parseReviewCount('No reviews'), 0);
});

test('reads Etsy-style ratings from the matched child data attribute', () => {
  const rating = new FixtureElement({ attributes: { 'data-rating': '4.5' } });
  const review = new FixtureElement({ children: { '[data-rating]': rating } });
  assert.equal(adapters.parseRating(review, ['[data-rating]'], kernel.normalizeRating), 4.5);
});

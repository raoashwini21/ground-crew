// Guess which column holds what. Ground Crew shows these guesses for the
// person to confirm; it never relies on them silently.

export const FIELDS = ['first_name', 'last_name', 'full_name', 'email', 'company', 'title', 'linkedin', 'website'];

export const FIELD_LABELS = {
  first_name: 'First name',
  last_name: 'Last name',
  full_name: 'Full name',
  email: 'Email',
  company: 'Company',
  title: 'Job title',
  linkedin: 'LinkedIn URL',
  website: 'Website',
};

// Header spellings seen in Apollo, Clay, Sales Navigator, Smartlead and
// hand-made sheets. Compared after squashing case, spaces and punctuation.
const SYNONYMS = {
  first_name: ['firstname', 'first', 'fname', 'givenname', 'contactfirstname', 'personfirstname'],
  last_name: ['lastname', 'last', 'lname', 'surname', 'familyname', 'contactlastname', 'personlastname'],
  full_name: ['name', 'fullname', 'contactname', 'personname', 'leadname', 'prospectname'],
  email: ['email', 'emailaddress', 'workemail', 'businessemail', 'contactemail', 'personemail', 'mail', 'email1', 'primaryemail'],
  company: ['company', 'companyname', 'organization', 'organisation', 'organizationname', 'account', 'accountname', 'employer', 'business'],
  title: ['title', 'jobtitle', 'position', 'role', 'designation', 'headline', 'persontitle'],
  linkedin: ['linkedin', 'linkedinurl', 'linkedinprofile', 'personlinkedinurl', 'linkedinprofileurl', 'profileurl', 'li'],
  website: ['website', 'companywebsite', 'domain', 'companydomain', 'url', 'websiteurl', 'companyurl', 'site'],
};

export function squash(header) {
  return String(header).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Returns { field: columnIndex } for every field it could place.
// Each column is used for at most one field.
export function guessColumns(headers) {
  const keys = headers.map(squash);
  const used = new Set();
  const map = {};

  // Exact synonym matches first, in field order.
  for (const field of FIELDS) {
    const idx = keys.findIndex((k, i) => !used.has(i) && SYNONYMS[field].includes(k));
    if (idx !== -1) { map[field] = idx; used.add(idx); }
  }
  // Then looser "contains" matches for anything still missing,
  // e.g. "Work Email (verified)" or "Company Name for Emails".
  for (const field of FIELDS) {
    if (field in map || field === 'full_name') continue;
    const needle = field === 'first_name' ? 'firstname'
      : field === 'last_name' ? 'lastname'
      : field === 'title' ? 'title'
      : field;
    const idx = keys.findIndex((k, i) => !used.has(i) && k.includes(needle));
    if (idx !== -1) { map[field] = idx; used.add(idx); }
  }
  // A full name column is only needed when there's no first name.
  if ('first_name' in map) delete map.full_name;
  return map;
}

// Template tags match columns by the same squashing, so {{First Name}},
// {{first_name}} and {{firstName}} all find the "First Name" column.
export function tagKey(tag) {
  return squash(tag);
}

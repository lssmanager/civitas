const { normalizeCrmCompanyInput } = require("./fluentCrm");

const trim = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const unique = (values) => [...new Set((Array.isArray(values) ? values : []).map(trim).filter(Boolean))];
const cleanObject = (obj) => Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)));

const FORM_FIELD_INVENTORY = Object.freeze({
  "name": ["logto.organization.topLevel.name", "fluentcrm.company.companyNameFallback"],
  "description/crm.description": ["logto.organization.topLevel.description", "logto.organization.customData.civitasProfile.business.description", "fluentcrm.company.description"],
  // Deprecated: slug is retained only in historical payload snapshots and must not regain functional URL/routing meaning.
  "slug (deprecated)": ["deprecated.logto.organization.customData.provisioning.slug", "deprecated.logto.organization.customData.civitasProfile.business.slug", "civitas.operation.payloadSnapshot.legacyOnly"],
  // Deprecated: business.subdomain is a legacy alias. New code must use appSubdomain + appBaseDomain.
  "appSubdomain/subdomain (subdomain deprecated)": ["logto.organization.customData.provisioning.appSubdomain", "logto.organization.customData.civitasProfile.business.appSubdomain", "deprecated.civitasProfile.business.subdomain", "civitas.organization_profiles.subdomain.operationalCache"],
  "appBaseDomain": ["logto.organization.customData.provisioning.appBaseDomain", "logto.organization.customData.civitasProfile.business.appBaseDomain"],
  "adminDomain/jitProvisioning.domain": ["logto.organization.customData.provisioning.institutionalDomain", "logto.jit.emailDomains", "civitas.organization_profiles.adminDomain"],
  // Deprecated: all baseAdmin.* fields are legacy creation input. administrativeContacts is the active user-seeding contract.
  "baseAdmin.firstName (deprecated)": ["deprecated.creation.baseAdmin.firstName", "use.administrativeContacts[].firstName"],
  "baseAdmin.middleName (deprecated)": ["deprecated.creation.baseAdmin.middleName", "use.administrativeContacts[].middleName"],
  "baseAdmin.firstSurname (deprecated)": ["deprecated.creation.baseAdmin.firstSurname", "use.administrativeContacts[].firstSurname"],
  "baseAdmin.secondSurname (deprecated)": ["deprecated.creation.baseAdmin.secondSurname", "use.administrativeContacts[].secondSurname"],
  "baseAdmin.name (deprecated)": ["deprecated.creation.baseAdmin.name", "use.administrativeContacts[].name"],
  "baseAdmin.email (deprecated)": ["deprecated.creation.baseAdmin.email", "use.administrativeContacts[].email"],
  "baseAdmin.phone (deprecated)": ["deprecated.creation.baseAdmin.phone", "use.administrativeContacts[].phone"],
  "baseAdmin.username (deprecated)": ["deprecated.creation.baseAdmin.username", "use.administrativeContacts[].username"],
  "baseAdmin.position (deprecated)": ["deprecated.creation.baseAdmin.position", "use.administrativeContacts[].position"],
  "baseAdmin.phoneExtension (deprecated)": ["deprecated.creation.baseAdmin.phoneExtension", "use.administrativeContacts[].phoneExtension"],
  "administrativeContacts.*": ["logto.user.topLevel/profile/customData (shared phone lines with extensions stay in customData)", "logto.membership.organizationRole", "fluentcrm.contact"],
  "crm.companyName/companyEmail/companyPhone/companyOwner/website/address/city/state/postalCode/country/numberOfEmployees/industry/type/about/description/nit/verificationDigit/tags/lists": ["logto.organization.customData.civitasProfile.business/contact/downstream.crm", "fluentcrm.company"],
  "adminRoleName/jitDefaultRoleName": ["logto.organizationRole", "logto.jit.defaultRoles", "civitas.operation.payloadSnapshot"],
});


function getPrimaryAdministrativeContact(canonical = {}) {
  const contacts = Array.isArray(canonical.administrativeContacts) ? canonical.administrativeContacts : [];
  return contacts.find((contact) => contact?.email || contact?.name) || null;
}

function buildLogtoOrganizationCustomData({ canonical = {}, extended = {}, crm = {} } = {}) {
  const normalizedCrm = normalizeCrmCompanyInput(crm, { name: canonical.name, adminDomain: extended.adminDomain });
  const business = cleanObject({
    appSubdomain: extended.appSubdomain || extended.subdomain,
    appBaseDomain: extended.appBaseDomain,
    entryUrl: extended.entryUrl,
    institutionalDomain: extended.adminDomain,
    website: normalizedCrm.website,
    type: normalizedCrm.type || extended.type,
    industry: normalizedCrm.industry,
    nit: normalizedCrm.nit,
    verificationDigit: normalizedCrm.verificationDigit,
    numberOfEmployees: normalizedCrm.numberOfEmployees,
    about: normalizedCrm.about,
    description: normalizedCrm.description || canonical.description,
    addressLine1: normalizedCrm.addressLine1,
    addressLine2: normalizedCrm.addressLine2,
    city: normalizedCrm.city,
    state: normalizedCrm.state,
    postalCode: normalizedCrm.postalCode,
    country: normalizedCrm.country,
  });
  const primaryAdministrativeContact = getPrimaryAdministrativeContact(canonical);
  const contact = cleanObject({ owner: normalizedCrm.companyOwner || primaryAdministrativeContact?.name, email: normalizedCrm.companyEmail || primaryAdministrativeContact?.email, phone: normalizedCrm.companyPhone || primaryAdministrativeContact?.phone });
  return cleanObject({
    provisioning: cleanObject({ appSubdomain: extended.appSubdomain || extended.subdomain, appBaseDomain: extended.appBaseDomain, entryUrl: extended.entryUrl, institutionalDomain: extended.adminDomain }),
    oidcRedirectUri: extended.oidcRedirectUri || null,
    civitasProfile: {
      version: 1,
      business,
      contact,
      downstream: { crm: cleanObject({ companyName: normalizedCrm.companyName, tags: normalizedCrm.tags, lists: normalizedCrm.lists, segmentation: { organizationTags: normalizedCrm.tags, organizationLists: normalizedCrm.lists } }) },
    },
  });
}

function buildLogtoOrganizationCreatePayload({ canonical = {}, extended = {}, crm = {} } = {}) {
  return cleanObject({ name: canonical.name, description: canonical.description || normalizeCrmCompanyInput(crm).description, customData: buildLogtoOrganizationCustomData({ canonical, extended, crm }) });
}

function buildLogtoUserProfile(person = {}) {
  return cleanObject({
    givenName: trim(person.firstName),
    middleName: trim(person.middleName),
    familyName: trim(person.firstSurname ?? person.lastName),
    preferredUsername: trim(person.username),
  });
}

function buildLogtoUserCustomData(person = {}) {
  return cleanObject({
    secondFamilyName: trim(person.secondSurname),
    civitasProfile: cleanObject({
      position: trim(person.position),
      phone: trim(person.phone),
      phoneExtension: trim(person.phoneExtension),
      source: "owner_organization_provisioning",
    }),
  });
}

function buildLogtoUserCreatePayload(person = {}) {
  const fullName = [trim(person.firstName), trim(person.middleName), trim(person.firstSurname ?? person.lastName), trim(person.secondSurname)].filter(Boolean).join(" ");
  // Logto primaryPhone is unique per user and cannot model a shared PBX/main line
  // differentiated only by extension. Keep those organization contact details in
  // Logto customData and FluentCRM contact data, not in Logto's unique top-level field.
  const phoneExtension = trim(person.phoneExtension);
  return cleanObject({ primaryEmail: trim(person.email)?.toLowerCase(), primaryPhone: phoneExtension ? null : trim(person.phone), username: trim(person.username), name: trim(person.name) || fullName || null, profile: buildLogtoUserProfile(person), customData: buildLogtoUserCustomData(person) });
}

function buildFluentCrmCompanyPayloadFromForm({ form = {}, canonical = {}, extended = {} } = {}) {
  const primaryAdministrativeContact = getPrimaryAdministrativeContact(canonical);
  return normalizeCrmCompanyInput({ companyOwner: primaryAdministrativeContact?.name, companyEmail: primaryAdministrativeContact?.email, companyPhone: primaryAdministrativeContact?.phone, ...(form.crm || form.fluentcrm || {}) }, { name: canonical.name || form.name, adminDomain: extended.adminDomain || form.adminDomain });
}

function buildFluentCrmContactPayloadFromAssignment({ assignment = {}, companyId = null, organizationLists = [], organizationTags = [] } = {}) {
  return cleanObject({
    identity: cleanObject({ logtoUserId: assignment.logtoUserId, logtoOrganizationId: assignment.logtoOrganizationId, email: assignment.email, previousEmail: assignment.previousEmail, name: assignment.name, firstName: assignment.firstName, middleName: assignment.middleName, lastName: assignment.lastName, firstSurname: assignment.firstSurname, secondSurname: assignment.secondSurname, username: assignment.username, phone: assignment.phone, position: assignment.position, phoneExtension: assignment.phoneExtension, lastLoginAt: assignment.lastLoginAt }),
    companyId,
    roleNames: [assignment.roleName || assignment.organizationRoleName].filter(Boolean),
    extraLists: unique(organizationLists),
    extraTags: unique(organizationTags),
  });
}

module.exports = { FORM_FIELD_INVENTORY, buildLogtoOrganizationCreatePayload, buildLogtoOrganizationCustomData, buildLogtoUserCreatePayload, buildLogtoUserProfile, buildLogtoUserCustomData, buildFluentCrmCompanyPayloadFromForm, buildFluentCrmContactPayloadFromAssignment };

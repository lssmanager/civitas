const { normalizeCrmCompanyInput } = require("./fluentCrm");

const trim = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const unique = (values) => [...new Set((Array.isArray(values) ? values : []).map(trim).filter(Boolean))];
const cleanObject = (obj) => Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)));

const FORM_FIELD_INVENTORY = Object.freeze({
  "name": ["logto.organization.topLevel.name", "fluentcrm.company.companyNameFallback"],
  "description/crm.description": ["logto.organization.topLevel.description", "logto.organization.customData.civitasProfile.business.description", "fluentcrm.company.description"],
  "slug": ["logto.organization.customData.provisioning.slug", "logto.organization.customData.civitasProfile.business.slug", "civitas.operation.payloadSnapshot"],
  "appSubdomain/subdomain": ["logto.organization.customData.provisioning.appSubdomain", "logto.organization.customData.civitasProfile.business.appSubdomain", "civitas.organization_profiles.subdomain"],
  "appBaseDomain": ["logto.organization.customData.provisioning.appBaseDomain", "logto.organization.customData.civitasProfile.business.appBaseDomain"],
  "adminDomain/jitProvisioning.domain": ["logto.organization.customData.provisioning.institutionalDomain", "logto.jit.emailDomains", "civitas.organization_profiles.adminDomain"],
  "baseAdmin.firstName": ["logto.user.profile.givenName", "fluentcrm.contact.firstName"],
  "baseAdmin.middleName": ["logto.user.profile.middleName"],
  "baseAdmin.firstSurname": ["logto.user.profile.familyName", "fluentcrm.contact.lastName"],
  "baseAdmin.secondSurname": ["logto.user.customData.secondFamilyName"],
  "baseAdmin.name": ["logto.user.topLevel.name", "fluentcrm.contact.full_name"],
  "baseAdmin.email": ["logto.user.topLevel.primaryEmail", "fluentcrm.contact.email"],
  "baseAdmin.phone": ["logto.user.topLevel.primaryPhone", "fluentcrm.contact.phone"],
  "baseAdmin.username": ["logto.user.topLevel.username", "logto.user.profile.preferredUsername"],
  "baseAdmin.position": ["logto.user.customData.civitasProfile.position", "fluentcrm.contact.job_title"],
  "baseAdmin.phoneExtension": ["logto.user.customData.civitasProfile.phoneExtension", "fluentcrm.contact.custom_values.phone_extension"],
  "administrativeContacts.*": ["logto.user.topLevel/profile/customData", "logto.membership.organizationRole", "fluentcrm.contact"],
  "crm.companyName/companyEmail/companyPhone/companyOwner/website/address/city/state/postalCode/country/numberOfEmployees/industry/type/about/description/nit/verificationDigit/tags/lists": ["logto.organization.customData.civitasProfile.business/contact/downstream.crm", "fluentcrm.company"],
  "adminRoleName/jitDefaultRoleName": ["logto.organizationRole", "logto.jit.defaultRoles", "civitas.operation.payloadSnapshot"],
});

function buildLogtoOrganizationCustomData({ canonical = {}, extended = {}, crm = {} } = {}) {
  const normalizedCrm = normalizeCrmCompanyInput(crm, { name: canonical.name, adminDomain: extended.adminDomain });
  const business = cleanObject({
    slug: extended.slug,
    subdomain: extended.subdomain,
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
  const contact = cleanObject({ owner: normalizedCrm.companyOwner || canonical.baseAdmin?.name, email: normalizedCrm.companyEmail, phone: normalizedCrm.companyPhone });
  return cleanObject({
    provisioning: cleanObject({ slug: extended.slug, appSubdomain: extended.appSubdomain || extended.subdomain, appBaseDomain: extended.appBaseDomain, entryUrl: extended.entryUrl, institutionalDomain: extended.adminDomain }),
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
      phoneExtension: trim(person.phoneExtension),
      source: "owner_organization_provisioning",
    }),
  });
}

function buildLogtoUserCreatePayload(person = {}) {
  const fullName = [trim(person.firstName), trim(person.middleName), trim(person.firstSurname ?? person.lastName), trim(person.secondSurname)].filter(Boolean).join(" ");
  return cleanObject({ primaryEmail: trim(person.email)?.toLowerCase(), primaryPhone: trim(person.phone), username: trim(person.username), name: trim(person.name) || fullName || null, profile: buildLogtoUserProfile(person), customData: buildLogtoUserCustomData(person) });
}

function buildFluentCrmCompanyPayloadFromForm({ form = {}, canonical = {}, extended = {} } = {}) {
  return normalizeCrmCompanyInput({ companyOwner: canonical.baseAdmin?.name, ...(form.crm || form.fluentcrm || {}) }, { name: canonical.name || form.name, adminDomain: extended.adminDomain || form.adminDomain });
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

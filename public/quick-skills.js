export const QUICK_SKILLS = Object.freeze([
  Object.freeze({
    id: 'deploy-check',
    label: 'Deploy check',
    prompt: `I want you to create me a full list of things we changed, it needs to be detailed so no change escapes it, it should basically compare with production and it should be a release-pdf with versions compared .. it's very important to have the sentences short (in bullet list) and the changes grouped by categories

it is for me to verify we did only changes which we wanted to, be sure to go through every changed line of code`,
  }),
]);

export function quickSkillById(id) {
  return QUICK_SKILLS.find((skill) => skill.id === id) || null;
}

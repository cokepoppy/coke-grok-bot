export interface ExplicitSkillMutations { create: boolean; update: boolean; delete: boolean }

/** Only direct first-party messages can authorize persistent Skill changes. */
export function explicitSkillMutations(prompt: string): ExplicitSkillMutations {
  const none={create:false,update:false,delete:false};
  const input=prompt.trim();
  if(!input||input.length>20_000||isNegated(input))return none;
  return {
    create:/^(?:please\s+)?(?:save|create|make|write|turn|convert|record)\b[\s\S]*\bskills?\b|^(?:请)?(?:帮我)?(?:把[\s\S]{1,80})?(?:保存|存为|创建|新建|制作|编写|记录)[\s\S]{0,80}(?:技能|skill)|^(?:我想要|我希望|请帮我|帮我)[\s\S]{0,80}(?:保存|存为|创建|新建|制作|编写|记录)[\s\S]{0,80}(?:技能|skill)/iu.test(input),
    update:/^(?:please\s+)?(?:edit|update|revise|rewrite|change)\b[\s\S]*\bskills?\b|^(?:请)?(?:帮我)?(?:编辑|更新|修改|改写)[\s\S]{0,80}(?:技能|skill)/iu.test(input),
    delete:/^(?:please\s+)?(?:delete|remove|forget)\b[\s\S]*\bskills?\b|^(?:请)?(?:帮我)?(?:删除|移除)[\s\S]{0,80}(?:技能|skill)/iu.test(input),
  };
}

function isNegated(value:string):boolean {
  return /^(?:please\s+)?(?:do not|don't|never|without)\s+(?:save|create|make|write|edit|update|revise|rewrite|change|delete|remove)\b[\s\S]{0,80}\bskills?\b|^(?:please\s+)?(?:don't|do not|never)\s+(?:use|create|save|edit|delete)\s+(?:a\s+)?skill\b|^(?:不要|别|无需|不必)[\s\S]{0,80}(?:技能|skill)/iu.test(value);
}

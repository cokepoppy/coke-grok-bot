/** Generate narrowly scoped RBAC and admission rules for a separate namespace bootstrap identity. */
export function namespaceBootstrapResources(options:{controlNamespace:string;bootstrapServiceAccount:string;brokerServiceAccount:string;bootstrapRole:string;brokerRole:string;policyPrefix:string}):Record<string,unknown>[] {
 const name=/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;
 if(Object.values(options).some(value=>!name.test(value)||value.length>50))throw new Error('Invalid namespace bootstrap configuration');
 if(options.bootstrapServiceAccount===options.brokerServiceAccount||options.bootstrapRole===options.brokerRole)throw new Error('Bootstrap and broker identities must be distinct');
 const {controlNamespace,bootstrapServiceAccount,brokerServiceAccount,bootstrapRole,brokerRole,policyPrefix}=options;
 const principal=`system:serviceaccount:${controlNamespace}:${bootstrapServiceAccount}`;
 const match=[{name:'bootstrap-identity',expression:`request.userInfo.username == ${JSON.stringify(principal)}`}];
 const namespaceValidation=[
  {expression:`object.metadata.name.matches('^grok-user-[a-f0-9]{32}$') && has(object.metadata.labels) && 'app.kubernetes.io/managed-by' in object.metadata.labels && object.metadata.labels['app.kubernetes.io/managed-by'] == 'coke-grok-bot' && 'coke-grok-bot.io/owner-hash' in object.metadata.labels && object.metadata.name == 'grok-user-' + object.metadata.labels['coke-grok-bot.io/owner-hash']`,message:'Only a labeled personal computer namespace may be created.'},
  {expression:`!has(object.metadata.generateName) && !has(object.metadata.ownerReferences) && !has(object.metadata.finalizers) && !has(object.metadata.annotations) && object.metadata.labels.all(k, k in ['app.kubernetes.io/managed-by','coke-grok-bot.io/owner-hash','kubernetes.io/metadata.name'])`,message:'Namespace metadata must be limited to the personal computer identity.'},
  {expression:`!has(object.spec) || !has(object.spec.finalizers) || object.spec.finalizers.all(f, f == 'kubernetes')`,message:'Custom namespace finalizers are not allowed.'},
 ];
 const bindingValidation=[
  {expression:`request.namespace.matches('^grok-user-[a-f0-9]{32}$') && namespaceObject != null && has(namespaceObject.metadata.labels) && 'app.kubernetes.io/managed-by' in namespaceObject.metadata.labels && namespaceObject.metadata.labels['app.kubernetes.io/managed-by'] == 'coke-grok-bot' && 'coke-grok-bot.io/owner-hash' in namespaceObject.metadata.labels && request.namespace == 'grok-user-' + namespaceObject.metadata.labels['coke-grok-bot.io/owner-hash']`,message:'Binding requires a labeled personal computer namespace.'},
  {expression:`object.metadata.name == 'desktop-provisioner' && !has(object.metadata.generateName) && !has(object.metadata.ownerReferences) && !has(object.metadata.finalizers) && !has(object.metadata.annotations) && object.roleRef.apiGroup == 'rbac.authorization.k8s.io' && object.roleRef.kind == 'ClusterRole' && object.roleRef.name == ${JSON.stringify(brokerRole)} && has(object.subjects) && object.subjects.size() == 1 && object.subjects[0].kind == 'ServiceAccount' && object.subjects[0].name == ${JSON.stringify(brokerServiceAccount)} && object.subjects[0].namespace == ${JSON.stringify(controlNamespace)}`,message:'Only the designated desktop broker may be bound to its fixed role.'},
 ];
 const policy=(suffix:string,resourceRules:unknown[],validations:unknown[])=>({apiVersion:'admissionregistration.k8s.io/v1',kind:'ValidatingAdmissionPolicy',metadata:{name:`${policyPrefix}-${suffix}`},spec:{failurePolicy:'Fail',matchConstraints:{resourceRules},matchConditions:match,validations}});
 const binding=(suffix:string)=>({apiVersion:'admissionregistration.k8s.io/v1',kind:'ValidatingAdmissionPolicyBinding',metadata:{name:`${policyPrefix}-${suffix}`},spec:{policyName:`${policyPrefix}-${suffix}`,validationActions:['Deny']}});
 return [
  // Apply policies and bindings before granting the bootstrap identity any cluster permissions.
  policy('namespace',[{apiGroups:[''],apiVersions:['v1'],operations:['CREATE'],resources:['namespaces'],scope:'Cluster'}],namespaceValidation),binding('namespace'),
  policy('binding',[{apiGroups:['rbac.authorization.k8s.io'],apiVersions:['v1'],operations:['CREATE'],resources:['rolebindings'],scope:'Namespaced'}],bindingValidation),binding('binding'),
  {apiVersion:'rbac.authorization.k8s.io/v1',kind:'ClusterRole',metadata:{name:brokerRole},rules:[{apiGroups:[''],resources:['persistentvolumeclaims','secrets','configmaps','services'],verbs:['get','create']},{apiGroups:['apps'],resources:['deployments'],verbs:['get','create']},{apiGroups:['networking.k8s.io'],resources:['networkpolicies'],verbs:['get','create']}]},
  {apiVersion:'rbac.authorization.k8s.io/v1',kind:'ClusterRole',metadata:{name:bootstrapRole},rules:[{apiGroups:[''],resources:['namespaces'],verbs:['get','create']},{apiGroups:['rbac.authorization.k8s.io'],resources:['rolebindings'],resourceNames:['desktop-provisioner'],verbs:['get']},{apiGroups:['rbac.authorization.k8s.io'],resources:['rolebindings'],verbs:['create']},{apiGroups:['rbac.authorization.k8s.io'],resources:['clusterroles'],resourceNames:[brokerRole],verbs:['bind']}]},
  {apiVersion:'rbac.authorization.k8s.io/v1',kind:'ClusterRoleBinding',metadata:{name:bootstrapRole},subjects:[{kind:'ServiceAccount',name:bootstrapServiceAccount,namespace:controlNamespace}],roleRef:{apiGroup:'rbac.authorization.k8s.io',kind:'ClusterRole',name:bootstrapRole}},
 ];
}

export function personalDesktopBinding(namespace:string,options:{controlNamespace:string;brokerServiceAccount:string;brokerRole:string}):Record<string,unknown>{
 if(!/^grok-user-[a-f0-9]{32}$/.test(namespace)||Object.values(options).some(value=>!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value)||value.length>50))throw new Error('Invalid personal desktop binding');
 return {apiVersion:'rbac.authorization.k8s.io/v1',kind:'RoleBinding',metadata:{name:'desktop-provisioner',namespace},subjects:[{kind:'ServiceAccount',name:options.brokerServiceAccount,namespace:options.controlNamespace}],roleRef:{apiGroup:'rbac.authorization.k8s.io',kind:'ClusterRole',name:options.brokerRole}};
}

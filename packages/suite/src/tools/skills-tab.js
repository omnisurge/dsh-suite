/** Skills management tab for the Skills & MCP panel (ADR-026/027/051). Extracted per ADR-117 D4. */
import * as React from 'react';
import {ActionGroup,Badge,Button,Disclosure,EmptyState,Field,FormGrid,KeyValueList,ListRow,SearchInput,Select,SheetHead,StatusLine,Switch,TextArea,TextInput,showConfirm,showToast} from '@omnisurge/dsh-ui';
import {fillTemplate as fill} from '../shared/client-copy.js';
import {DiagnosticDisclosure} from '../shared/DiagnosticDisclosure.js';
import {SOURCE_WORDS,mutationRaw,skillsMutationSentence,skillsSentence} from './client-format.js';

const h=React.createElement;
/** Sources the Host documents as package/runtime-owned, shown as "shipped with a package". */
const SKILLS_PACKAGED_SOURCES=new Set(['bundled','office','runtime']);
/** The Host's write path can only reach these two roots (ADR-026): $DSH_HOME/skills and <project>/.dsh/skills.
 * A skill from ~/.agents/skills, <project>/.agents/skills or a custom root is someone else's file, so this page
 * must not offer an action the Host would refuse; those rows are read-only with their own reason. */
const WRITABLE_SKILL_SOURCES=new Set(['user-dsh','project-dsh']);
const skillWritable=skill=>{
  const path=typeof skill.path==='string'&&skill.path.length>0;
  const source=typeof skill.source==='string'?skill.source:'';
  return path&&WRITABLE_SKILL_SOURCES.has(source);
};
/** The source also names the root. removeSkill/readSkill without a scope search the user root only, so a project
 * row must pass 'project' or the Host answers skills/not-editable. Unwritable sources never reach these calls. */
const skillScopeOf=source=>source==='user-dsh'?'user':source==='project-dsh'?'project':undefined;

/**
 * The skills tab: the migrated 0.1.3 catalogue, now with create/edit/delete.
 *
 * Rows keep the read-only facts (provider, source, invocation, path, expansion) and add one action cluster. A
 * package/runtime skill or a row without a file path hides Edit and disables Delete with the reason inline: the
 * page must not offer a write the Host would refuse. Editing first calls readSkill for the body, because the list
 * entry deliberately carries no body; a failed read lands as a page-level sentence, never as a half-filled form.
 * Credentials are not a skill concept, so this form has no write-only field. Every sentence is dictionary copy.
 */
export function SkillsTab(props){
  const t=props.t,skillsT=props.skillsT,slot=props.panel,start=props.start,mutate=props.mutate;
  const [filter,setFilter]=React.useState('');
  const [form,setForm]=React.useState(null);
  const [values,setValues]=React.useState(null);
  const [savePhase,setSavePhase]=React.useState('idle');
  const [saveIssue,setSaveIssue]=React.useState(null);
  const [actionIssue,setActionIssue]=React.useState(null);
  const [opening,setOpening]=React.useState(null);
  const [removing,setRemoving]=React.useState(null);
  const confirmRef=React.useRef(null);
  React.useEffect(()=>()=>{if(confirmRef.current!==null){confirmRef.current.close();confirmRef.current=null;}},[]);
  const busy=slot.phase==='loading';
  const catalog=slot.data;
  const skills=catalog!==null&&Array.isArray(catalog.skills)?catalog.skills:[];
  const roots=catalog!==null&&catalog.roots!==null&&typeof catalog.roots==='object'?catalog.roots:{};
  const userRoot=typeof roots.user==='string'&&roots.user.length>0?roots.user:null;
  const projectRoot=typeof roots.project==='string'&&roots.project.length>0?roots.project:null;
  const query=filter.trim().toLowerCase();
  const visible=query.length===0?skills:skills.filter(skill=>{
    const haystack=[skill.name,skill.description,skill.whenToUse].filter(value=>typeof value==='string').join('\n').toLowerCase();
    return haystack.includes(query);
  });
  const sentence=skillsSentence(skillsT,slot.issue);
  const sources=new Set(skills.filter(skill=>typeof skill.source==='string'&&skill.source.length>0).map(skill=>skill.source)).size;
  const providers=new Set(skills.filter(skill=>typeof skill.provider==='string'&&skill.provider.length>0).map(skill=>skill.provider)).size;
  const summary=catalog===null?t('summaryPending'):fill(t('skillsSummary'),{skills:skills.length,sources,providers});
  const receipt=slot.lastRead===null?null:h('span',{className:'omni-ui-hint','data-testid':'skills-checked'},fill(t('checkedAt'),{time:slot.lastRead}));
  const setValue=(key,value)=>setValues(current=>current===null?current:{...current,[key]:value});
  const closeForm=()=>{setForm(null);setValues(null);setSaveIssue(null);setSavePhase('idle');};
  const openAdd=()=>{
    setActionIssue(null);setSaveIssue(null);
    setValues({name:'',description:'',whenToUse:'',body:'',modelInvocable:true,userInvocable:true,scope:'user'});
    setForm({mode:'add',document:null});
  };
  const openEdit=async skill=>{
    setActionIssue(null);setSaveIssue(null);setOpening(String(skill.name));
    try{
      const scope=skillScopeOf(typeof skill.source==='string'?skill.source:'');
      const document=scope===undefined?await mutate('readSkill',String(skill.name)):await mutate('readSkill',String(skill.name),scope);
      setValues({
        name:typeof document.name==='string'?document.name:String(skill.name),
        description:typeof document.description==='string'?document.description:'',
        whenToUse:typeof document.whenToUse==='string'?document.whenToUse:'',
        body:typeof document.body==='string'?document.body:'',
        modelInvocable:document.modelInvocable===true,
        userInvocable:document.userInvocable===true,
        scope:document.scope==='project'?'project':'user',
      });
      setForm({mode:'edit',document});
    }catch(failed){
      setActionIssue({sentence:skillsMutationSentence(t,failed),raw:mutationRaw(failed)});
    }finally{
      setOpening(null);
    }
  };
  const buildDraft=()=>{
    const draft={
      name:String(values.name).trim(),
      description:String(values.description).trim(),
      body:String(values.body),
      modelInvocable:values.modelInvocable===true,
      userInvocable:values.userInvocable===true,
      scope:values.scope==='project'?'project':'user',
    };
    const when=String(values.whenToUse).trim();
    if(when.length>0)draft.whenToUse=when;
    return draft;
  };
  const submit=async()=>{
    if(savePhase==='saving'||form===null)return;
    setSavePhase('saving');setSaveIssue(null);
    try{
      const draft=buildDraft();
      const mutation=form.mode==='add'
        ?await mutate('createSkill',draft)
        :await mutate('updateSkill',String(form.document?.name??draft.name),draft);
      const name=mutation&&typeof mutation.name==='string'?mutation.name:draft.name;
      showToast({text:fill(t('mutationToast'),{action:t(form.mode==='add'?'skillsCreated':'skillsUpdated'),state:t('skillsWritten'),name}),kind:'skills-mutation',closeLabel:t('closeToast')});
      closeForm();
      start();
    }catch(failed){
      setSaveIssue({sentence:skillsMutationSentence(t,failed),raw:mutationRaw(failed)});
    }finally{
      setSavePhase('idle');
    }
  };
  const remove=async skill=>{
    setActionIssue(null);setRemoving(String(skill.name));
    try{
      const scope=skillScopeOf(typeof skill.source==='string'?skill.source:'');
      const mutation=scope===undefined?await mutate('removeSkill',String(skill.name)):await mutate('removeSkill',String(skill.name),scope);
      const name=mutation&&typeof mutation.name==='string'?mutation.name:String(skill.name);
      showToast({text:fill(t('skillsRemovedToast'),{action:t('skillsDeleted'),name}),kind:'skills-mutation',closeLabel:t('closeToast')});
      start();
    }catch(failed){
      setActionIssue({sentence:skillsMutationSentence(t,failed),raw:mutationRaw(failed)});
    }finally{
      setRemoving(null);
    }
  };
  const askRemove=skill=>{
    if(confirmRef.current!==null)confirmRef.current.close();
    const path=typeof skill.path==='string'&&skill.path.length>0?skill.path:String(skill.name);
    const scope=skillScopeOf(typeof skill.source==='string'?skill.source:'');
    const text=scope==='project'?fill(skillsT('deleteTextProject'),{path}):scope==='user'?fill(skillsT('deleteTextUser'),{path}):fill(t('skillsDeleteText'),{path});
    confirmRef.current=showConfirm({
      title:t('skillsDeleteTitle'),
      text,
      cancelLabel:t('cancel'),
      confirmLabel:t('remove'),
      tone:'danger',
      onCancel:()=>{confirmRef.current=null;},
      onConfirm:()=>{confirmRef.current=null;void remove(skill);},
    });
  };
  const formSection=()=>{
    const add=form.mode==='add';
    const document=form.document;
    const scopeRoot=values.scope==='project'?projectRoot:userRoot;
    return h('section',{className:'omni-ui-stack','data-testid':'skills-form-section'},
      h(SheetHead,{title:add?t('skillsAddTitle'):t('skillsEditTitle'),dismissLabel:t('back'),onDismiss:closeForm}),
      h('div',{className:'omni-ui-stack','data-testid':'skills-form'},
        h(Field,{label:t('skillsName'),hint:t('skillsNameHint')},
          h(TextInput,{name:'skillName',autoComplete:'off',disabled:!add,value:values.name,onChange:event=>setValue('name',event.target.value),'data-testid':'skills-form-name'})),
        h(Field,{label:t('skillsDescription')},
          h(TextInput,{name:'description',autoComplete:'off',value:values.description,onChange:event=>setValue('description',event.target.value),'data-testid':'skills-form-description'})),
        h(Field,{label:t('whenToUse')},
          h(TextInput,{name:'whenToUse',autoComplete:'off',value:values.whenToUse,onChange:event=>setValue('whenToUse',event.target.value),'data-testid':'skills-form-when'})),
        h(Field,{label:t('skillsBody'),hint:t('skillsBodyHint')},
          h(TextArea,{name:'body',rows:12,variant:'notes',className:'omni-ui-mono',value:values.body,onChange:event=>setValue('body',event.target.value),'data-testid':'skills-form-body'})),
        h(Switch,{label:skillsT('invocationModel'),checked:values.modelInvocable,onChange:event=>setValue('modelInvocable',event.target.checked),'data-testid':'skills-form-model'}),
        h(Switch,{label:skillsT('invocationUser'),checked:values.userInvocable,onChange:event=>setValue('userInvocable',event.target.checked),'data-testid':'skills-form-user'}),
        h(Field,{label:t('skillsScope'),hint:values.scope==='project'?t('skillsScopeProjectHint'):t('skillsScopeUserHint')},
          h(Select,{name:'scope',disabled:!add,value:values.scope,onChange:event=>setValue('scope',event.target.value),'data-testid':'skills-form-scope'},
            h('option',{value:'user'},t('skillsScopeUser')),
            projectRoot!==null||values.scope==='project'?h('option',{value:'project'},t('skillsScopeProject')):null),
          scopeRoot===null?null:h('p',{className:'omni-ui-hint'},h('code',{className:'omni-ui-mono','data-testid':'skills-form-scope-path'},scopeRoot)),
          values.scope==='project'?h('p',{className:'omni-ui-hint','data-testid':'skills-form-scope-note'},skillsT('scopeProjectNote')):null,
          add&&projectRoot===null?h('p',{className:'omni-ui-hint','data-testid':'skills-form-scope-unavailable'},skillsT('scopeProjectUnavailable')):null),
        document!==null&&typeof document.path==='string'&&document.path.length>0?h(KeyValueList,{items:[{label:skillsT('path'),value:document.path,mono:true,copy:document.path,copyLabel:skillsT('copyPath'),copiedLabel:skillsT('copiedPath'),'data-value-testid':'skills-form-path'}]}):null,
        saveIssue===null?null:h('div',{className:'omni-ui-stack','data-testid':'skills-save-failure'},
          h(StatusLine,{tone:'warn',role:'alert','data-testid':'skills-save-error'},saveIssue.sentence),
          h(DiagnosticDisclosure,{testId:'skills-save-raw',title:t('rawDetails'),text:saveIssue.raw})),
        h(ActionGroup,null,
          h(Button,{variant:'primary',busy:savePhase==='saving',onClick:()=>{void submit();},'data-testid':'skills-form-save'},savePhase==='saving'?t('saving'):t('save')),
          h(Button,{variant:'ghost',onClick:closeForm,'data-testid':'skills-form-cancel'},t('cancel')))));
  };
  const skillsProviderWord=skill=>{
    const provider=typeof skill.provider==='string'&&skill.provider.length>0?skill.provider:null;
    if(provider===null)return null;
    return provider==='runtime'?skillsT('providerRuntime'):provider==='filesystem'?skillsT('providerFilesystem'):provider;
  };
  const sourceWord=skill=>{
    const source=typeof skill.source==='string'&&skill.source.length>0?skill.source:null;
    if(source===null)return null;
    const key=SOURCE_WORDS.get(source);
    return key===undefined?source:skillsT(key);
  };
  // One fact, one badge word: the scope when the skill has one, otherwise its provider (ADR-051).
  const skillsBadgeWord=skill=>{const scope=sourceWord(skill);return scope!==null?scope:skillsProviderWord(skill);};
  // ADR-051: every skill row carries exactly one badge in its title row. The scope wins (deleting a project
  // skill is not the same loss as a user skill); a runtime-provided skill has no scope, so its provider stands
  // in — a row must never read as "badgeless", because then the badge stops meaning anything.
  const skillsBadge=skill=>{
    const word=skillsBadgeWord(skill);
    if(word===null)return null;
    const scope=sourceWord(skill);
    return scope!==null
      ?h(Badge,{key:'source',tone:'muted','data-testid':'skills-source-'+skill.name},word)
      :h(Badge,{key:'provider',tone:'muted','data-testid':'skills-provider-'+skill.name},word);
  };
  // ADR-049 D1/D2: a badge carries the fact with consequences (scope: deleting a project skill is not the
  // same loss as a user skill); provider and invocation are background and read as one grey meta line.
  const skillsMeta=skill=>{
    const name=String(skill.name);
    const providerWord=skillsProviderWord(skill);
    const model=skill.modelInvocable===true,user=skill.userInvocable===true;
    const parts=[];
    // The provider is the badge when the skill has no scope; showing it twice would make the badge look like noise.
    if(providerWord!==null&&skillsBadgeWord(skill)!==providerWord)parts.push(h('span',{key:'provider','data-testid':'skills-provider-'+name},providerWord));
    if(!model&&!user)parts.push(h('span',{key:'none','data-testid':'skills-invocation-none-'+name},skillsT('invocationNone')));
    if(model)parts.push(h('span',{key:'model','data-testid':'skills-model-'+name},skillsT('invocationModel')));
    if(user)parts.push(h('span',{key:'user','data-testid':'skills-user-'+name},skillsT('invocationUser')));
    return h('span',{'data-testid':'skills-meta-'+name},parts.flatMap((part,index)=>index===0?[part]:[' · ',part]));
  };
  const row=skill=>{
    const name=String(skill.name);
    const path=typeof skill.path==='string'&&skill.path.length>0?skill.path:null;
    const when=typeof skill.whenToUse==='string'&&skill.whenToUse.length>0?skill.whenToUse:null;
    const writable=skillWritable(skill);
    const source=typeof skill.source==='string'?skill.source:'';
    const readOnlyReason=SKILLS_PACKAGED_SOURCES.has(source)?'skillsBundled':'skillsManagedElsewhere';
    const facts=[
      {label:t('providerLabel'),value:typeof skill.provider==='string'?skill.provider:'',mono:true},
      {label:t('sourceLabel'),value:typeof skill.source==='string'?skill.source:'',mono:true},
    ];
    return h(ListRow,{
      key:name,
      'data-testid':'skills-row-'+name,
      title:name,
      badge:skillsBadge(skill),
      meta:skillsMeta(skill),
      description:skill.description,
      actions:h(ActionGroup,null,
        writable?h(Button,{variant:'ghost',busy:opening===name,onClick:()=>{void openEdit(skill);},'data-testid':'skills-edit-'+name},t('edit')):null,
        h(Button,{variant:'danger-ghost',disabled:!writable,busy:removing===name,onClick:()=>askRemove(skill),'data-testid':'skills-delete-'+name},t('remove')),
        writable?null:h('span',{className:'omni-ui-hint','data-testid':'skills-readonly-'+name},t(readOnlyReason))),
    },
      h('div',{className:'omni-ui-listFacts','data-testid':'skills-facts-zone-'+name},
      when===null?null:h('p',{className:'omni-ui-hint','data-testid':'skills-when-'+name},t('whenToUse')+': '+when),
      path===null?null:h(KeyValueList,{items:[{
        label:skillsT('path'),
        value:path,
        mono:true,
        copy:path,
        copyLabel:skillsT('copyPath'),
        copiedLabel:skillsT('copiedPath'),
        'data-value-testid':'skills-path-'+name,
      }]}),
      h(Disclosure,{'data-testid':'skills-details-'+name,title:t('details')},
        h(KeyValueList,{'data-testid':'skills-facts-'+name,items:facts}))));
  };
  if(form!==null&&values!==null)return formSection();
  return h('section',{className:'omni-ui-stack','data-testid':'skills-section','aria-label':t('title')},
    h('ul',{className:'omni-ui-list','data-testid':'skills-summary'},
      h(ListRow,{'data-testid':'skills-status-row',title:summary,
        actions:h(ActionGroup,null,receipt,h(Button,{'data-testid':'skills-refresh',busy,onClick:()=>start()},busy?t('refreshing'):t('refresh')))})),
    h('div',{className:'omni-ui-toolbar','data-testid':'skills-toolbar'},
      h(SearchInput,{
        name:'skills-filter',
        'aria-label':skillsT('filterLabel'),
        placeholder:skillsT('filterPlaceholder'),
        value:filter,
        onChange:event=>setFilter(event.target.value),
        'data-testid':'skills-filter',
      }),
      h(Button,{onClick:openAdd,'data-testid':'skills-create'},t('skillsCreate'))),
    sentence===null?null:h('div',{className:'omni-ui-stack','data-testid':'skills-failure-block'},
      h(StatusLine,{tone:'warn',role:'alert','data-testid':'skills-failure'},sentence),
      h(DiagnosticDisclosure,{testId:'skills-failure-raw',title:t('rawDetails'),text:slot.issue.raw})),
    actionIssue===null?null:h('div',{className:'omni-ui-stack','data-testid':'skills-action-failure'},
      h(StatusLine,{tone:'warn',role:'alert','data-testid':'skills-action-error'},actionIssue.sentence),
      h(DiagnosticDisclosure,{testId:'skills-action-raw',title:t('rawDetails'),text:actionIssue.raw})),
    visible.length===0?null:h('ul',{className:'omni-ui-list','data-testid':'skills-list'},visible.map(row)),
    catalog!==null&&visible.length===0&&slot.complete===true&&sentence===null?h('div',{'data-testid':'skills-empty'},
      h(EmptyState,{title:skillsT('emptyTitle'),description:skillsT('emptyDescription')})):null,
    catalog!==null&&slot.complete===false&&sentence===null?h(StatusLine,{tone:'warn','data-testid':'skills-incomplete'},skillsT('incomplete')):null);
}

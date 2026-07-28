# Runline plugin access annotation checklist

Status values: `pending`, `in-progress`, `done`.

| Plugin | Status | Summary |
|---|---|---|
| `actionNetwork` | done | Annotated 23 actions: 12 read (`*.get`, `*.list`) and 11 write (`*.create`, `*.update`, `personTag.add`, `personTag.remove`). |
| `activeCampaign` | done | Annotated 48 actions: 18 read (`*.get`, `*.list`, e-commerce order-product getters) and 30 write (create/update/delete/add/remove/note/association/connection mutations). |
| `adalo` | done | Annotated 5 actions: 2 read (`collection.get`, `collection.list`) and 3 write (`collection.create`, `collection.update`, `collection.delete`). |
| `affinity` | done | Annotated 16 actions: 8 read (`*.get`, `*.list`) and 8 write (`*.create`, `*.update`, `*.delete`). |
| `agileCrm` | done | Annotated 15 actions: 6 read (`*.get`, `*.list`, including POST-backed filter list calls with no intended mutation) and 9 write (`*.create`, `*.update`, `*.delete`). |
| `airtable` | done | Annotated 10 actions: 4 read (`base.list`, `base.getSchema`, `record.get`, `record.search`) and 6 write (`record.create`, `record.createMany`, `record.update`, `record.updateMany`, `record.upsert`, `record.delete`). |
| `airtop` | done | Annotated 24 actions: 5 read (`session.waitForDownload`, `window.list`, `window.getLiveView`, `file.get`, `file.list`) and 19 write (session/window lifecycle, navigation, screenshot, extraction/interaction/agent execution, file mutation/upload/load). Ambiguity resolved conservatively as write for POST-backed extraction/automation actions that execute external work. |
| `apiTemplateIo` | done | Annotated 4 actions: 2 read (`account.get`, `template.list`) and 2 write (`image.create`, `pdf.create` render/generation actions). |
| `asana` | done | Annotated 22 actions: 8 read (`task.get`, `task.list`, `task.search`, `subtask.list`, user/project get/list) and 14 write (task/subtask/comment/tag/project create/update/delete/move/add/remove mutations). |
| `autopilot` | done | Annotated 11 actions: 5 read (`contact.get`, `contact.list`, `contactList.exists`, `contactList.list`, `list.list`) and 6 write (`contact.upsert`, `contact.delete`, journey/list add/remove, `list.create`). |
| `bambooHr` | done | Annotated 11 actions: 5 read (`employee.get`, `employee.list`, `employeeDocument.list`, `file.list`, `companyReport.get`) and 6 write (employee create/update plus employee/company file metadata updates and deletes). |
| `bannerbear` | done | Annotated 4 actions: 3 read (`image.get`, `template.get`, `template.list`) and 1 write (`image.create` render/generation action). |
| `baserow` | done | Annotated 8 actions: 2 read (`row.get`, `row.list`) and 6 write (`row.create`, `row.update`, `row.delete`, batch create/update/delete). |
| `beeminder` | done | Annotated 18 actions: 6 read (datapoint/goal/user get/list actions) and 12 write (datapoint create/update/delete, charge/goal create/update, pledge/derail/refresh actions). `goal.refresh` is marked write because it triggers external graph refresh work. |
| `bitly` | done | Annotated 3 actions: 1 read (`link.get`) and 2 write (`link.create`, `link.update`). |
| `bitwarden` | done | Annotated 19 actions: 9 read (collection/event/group/member get/list/member ID lookups) and 10 write (collection/group/member create/update/delete and membership assignment mutations). |
| `box` | done | Annotated 11 actions: 4 read (`file.get`, `file.search`, `folder.get`, `folder.search`) and 7 write (file copy/delete/share plus folder create/delete/share/update). |
| `brandfetch` | done | Annotated 5 actions: all read (`brand.getLogos`, `brand.getColors`, `brand.getFonts`, `brand.getCompany`, `brand.getIndustry`). |
| `brevo` | done | Annotated 15 actions: 4 read (`contact.get`, `contact.list`, `attribute.list`, `sender.list`) and 11 write (contact/attribute/sender create/update/delete/upsert plus transactional email send actions). |
| `bubble` | done | Annotated 5 actions: 2 read (`object.get`, `object.list`) and 3 write (`object.create`, `object.update`, `object.delete`). |
| `chargebee` | done | Annotated 5 actions: 1 read (`invoice.list`) and 4 write (`customer.create`, `invoice.getPdfUrl`, `subscription.cancel`, `subscription.delete`). `invoice.getPdfUrl` is marked write because it POSTs to generate/prepare a PDF download URL. |
| `circleci` | done | Annotated 3 actions: 2 read (`pipeline.get`, `pipeline.list`) and 1 write (`pipeline.trigger`). |
| `ciscoWebex` | done | Annotated 10 actions: 4 read (`message.get`, `message.list`, `meeting.get`, `meeting.list`) and 6 write (message/meeting create/update/delete). |
| `clearbit` | done | Annotated 3 actions: all read (`person.enrich`, `company.enrich`, `company.autocomplete`). |
| `clickup` | done | Annotated 61 actions: 17 read (comment/folder/goal/guest/task/space tag/list/time entry get/list/member/custom-field lookups) and 44 write (checklist/comment/folder/goal/key result/guest/task/tag/list/dependency/time-entry create/update/delete/add/remove/start/stop/set mutations). |
| `clockify` | done | Annotated 25 actions: 10 read (client/project/tag/task/time-entry/user/workspace get/list actions) and 15 write (client/project/tag/task/time-entry create/update/delete mutations). |
| `cloudflare` | done | Annotated 4 actions: 2 read (`zoneCertificate.get`, `zoneCertificate.list`) and 2 write (`zoneCertificate.upload`, `zoneCertificate.delete`). |
| `cockpit` | done | Annotated 5 actions: 2 read (`collection.list`, `singleton.get`) and 3 write (`collection.create`, `collection.update`, `form.submit`). `collection.list` is POST-backed but classified read because it is a query operation. |
| `coda` | done | Annotated 18 actions: 12 read (table/view row/column list/get plus formula/control/view get/list actions) and 6 write (table row create/delete/button push plus view row update/delete/button push). |
| `coingecko` | done | Annotated 10 actions: all read (coin market/detail/price/history/chart/ticker/candlestick lookups and `event.list`). |
| `contentful` | done | Annotated 7 actions: all read (`space.get`, `contentType.get`, entry/asset get/list, `locale.list`) using Contentful delivery/preview APIs only. |
| `convertkit` | done | Annotated 16 actions: 8 read (custom field/form/sequence/tag/subscriber get/list/subscription list actions) and 8 write (custom field create/update/delete, form/sequence subscribe, tag create, tag subscriber add/remove). |
| `copper` | done | Annotated 32 actions via helper and direct registrations: 14 read (CRUD get/list plus `customerSource.list`, `user.list`) and 18 write (CRUD create/update/delete for company, lead, opportunity, person, project, task). |
| `cortex` | done | Annotated 4 actions: 2 read (`job.get`, `job.getReport`) and 2 write (`analyzer.execute`, `responder.execute`) because they run external analysis/response jobs. |
| `currents` | done | Annotated 22 actions: 12 read (action/instance/project/run/spec/test/test-result get/list/find/insights) and 10 write (action create/update/enable/disable/delete, run cancel/reset/delete, `signature.generate`). `signature.generate` is marked write conservatively because it POSTs to generate external signature data. |
| `customerIo` | done | Annotated 9 actions: 3 read (`campaign.get`, `campaign.list`, `campaign.getMetrics`) and 6 write (customer upsert/delete, event tracking, segment add/remove customers). |
| `databricks` | done | Annotated 34 actions: 16 read (file metadata/listing, Genie message/query-result/space reads, Unity Catalog get/list actions, vector search get/list/query) and 18 write (SQL execution, file directory/file mutations, Genie conversation/message/query execution, model serving invocation, Unity Catalog create/update/delete actions, vector search index creation). `sql.executeQuery` and `modelServing.queryEndpoint` are marked write conservatively because they execute external compute and SQL may mutate state. |
| `deepl` | done | Annotated 2 actions: 1 read (`language.list`) and 1 write (`language.translate`) because translation POSTs to perform external processing. |
| `demio` | done | Annotated 4 actions: 3 read (`event.get`, `event.list`, `report.getParticipants`) and 1 write (`event.register`). |
| `dhl` | done | Annotated 1 action: 1 read (`shipment.track`). |
| `discord` | done | Annotated 13 actions: 5 read (`channel.get`, `channel.list`, `member.list`, `message.get`, `message.list`) and 8 write (channel create/update/delete, member role add/remove, message send/delete/react). |
| `discourse` | done | Annotated 16 actions: 7 read (`category.list`, group/post/user get/list actions) and 9 write (category/group/post/user create/update plus user group add/remove). |
| `disqus` | done | Annotated 4 actions: all read (`forum.get`, `forum.listPosts`, `forum.listCategories`, `forum.listThreads`). |
| `docker` | done | Annotated 5 actions: 2 read (`containers.list`, `images.list`) and 3 write (`containers.start`, `containers.stop`, `images.pull`). |
| `drift` | done | Annotated 5 actions: 2 read (`contact.get`, `contact.getCustomAttributes`) and 3 write (`contact.create`, `contact.update`, `contact.delete`). |
| `dropbox` | done | Annotated 9 actions: 2 read (`folder.list`, `search.query`) and 7 write (file/folder copy/move/delete plus folder create). |
| `dropcontact` | done | Annotated 2 actions: 1 read (`contact.fetchRequest`) and 1 write (`contact.enrich`) because enrichment POSTs to start external processing. |
| `egoi` | done | Annotated 4 actions: 2 read (`contact.get`, `contact.list`) and 2 write (`contact.create`, `contact.update`, including tag attachment side effects). |
| `elasticsearch` | done | Annotated 9 actions: 4 read (`document.get`, `document.search`, `index.get`, `index.list`) and 5 write (`document.create`, `document.update`, `document.delete`, `index.create`, `index.delete`). |
| `emelia` | done | Annotated 9 actions: 3 read (`campaign.get`, `campaign.list`, `contactList.list`) and 6 write (campaign create/addContact/start/pause/duplicate plus contactList.addContact). |
| `erpnext` | done | Annotated 5 actions: 2 read (`document.get`, `document.list`) and 3 write (`document.create`, `document.update`, `document.delete`). |
| `facebookGraph` | done | Annotated 1 action: 1 write (`request`) because the generic Graph API request action supports POST and DELETE as well as GET. |
| `freshdesk` | done | Annotated 10 actions: 4 read (`ticket.get`, `ticket.list`, `contact.get`, `contact.list`) and 6 write (ticket/contact create/update/delete). |
| `freshservice` | done | Annotated 77 runtime actions via CRUD helper and direct registrations: 32 read (resource get/list plus agentRole get/list) and 45 write (resource create/update/delete). |
| `freshworksCrm` | done | Annotated 35 runtime actions via CRUD helper and direct registrations: 14 read (resource get/list where enabled plus `search.query`, `search.lookup`) and 21 write (resource create/update/delete). |
| `getresponse` | done | Annotated 5 actions: 2 read (`contact.get`, `contact.list`) and 3 write (`contact.create`, `contact.update`, `contact.delete`). |
| `ghost` | done | Annotated 5 actions: 2 read (`post.get`, `post.list`) and 3 write (`post.create`, `post.update`, `post.delete`). |
| `github` | done | Annotated 37 actions: 22 read (file/issue/release/commit/branch/repository/review/user/org/workflow get/list/usage actions) and 15 write (file create/update/delete, issue create/update/comment/lock, release create/update/delete, review create/update, user invite, workflow dispatch/enable/disable). |
| `gitlab` | done | Annotated 17 actions: 8 read (`issue.get`, release get/list, repository get/listIssues, `user.listProjects`, file get/list) and 9 write (issue create/update/note/lock, release create/update/delete, file createOrUpdate/delete). |
| `gmail` | done | Annotated 32 actions: 11 read (message/thread/draft/label get/list, attachment/profile/alias reads) and 21 write (send/reply, message/thread delete/trash/untrash/label/read-state mutations, draft create/delete/send, label create/update/delete). |
| `gong` | done | Annotated 4 actions: all read (`call.get`, `call.list`, `user.get`, `user.list`). Gong uses POST for filtered retrieval, but these actions only fetch call/user data and do not mutate external state. |
| `googleAppsScript` | done | Annotated 10 actions: 4 read (`script.list`, `project.getContent`, `project.readFile`, `process.list`) and 6 write (`file.edit`, `project.updateContent`, `project.create`, `version.create`, `deployment.create`, `function.run`). `function.run` is marked write because it executes external Apps Script code that may have side effects. |
| `googleCalendar` | done | Annotated 22 actions: 12 read (calendar/event/freeBusy/calendarList/ACL/settings get/list/availability/query actions) and 10 write (event create/update/delete/move, calendarList insert/patch/delete, ACL insert/update/delete). |
| `googleContacts` | done | Annotated 10 actions: 4 read (`contact.get`, `contact.list`, `group.list`, `group.get`) and 6 write (`contact.create`, `contact.update`, `contact.delete`, `group.create`, `group.update`, `group.delete`). |
| `googleDocs` | done | Annotated 44 actions across modular source files: 1 read (`document.get`) and 43 write (document creation/batch updates plus text/table/tab/structure/formatting/image mutations). `document.batchUpdate` is marked write because it can perform arbitrary Docs mutations. |
| `googleDrive` | done | Annotated 47 actions: 15 read (file/drive/comment/reply/revision/change/accessProposal/about get/list/search metadata actions) and 32 write (uploads, create/copy/move/update/delete/share/permission, folder/drive/comment/reply/revision mutations, changes watch/stop, accessProposal resolve, downloads/exports that can write to local `savePath`). Downloads/exports are marked write conservatively because they can write files to disk. |
| `googleImage` | done | Annotated 1 action: 1 write (`image.create`) because it triggers external image generation and writes generated image files to disk. |
| `googleSheets` | done | Annotated 23 actions: 3 read (`spreadsheet.get`, `sheet.listTabs`, `sheet.read`) and 20 write (spreadsheet/sheet/tab/value/chart/named-range/protected-range/conditional-format/data-validation create/update/delete/append/clear/batch mutations). `sheet.batchUpdate` is marked write because it can perform arbitrary Sheets mutations. |
| `googleSlides` | done | Annotated 7 actions: 3 read (`presentation.get`, `presentation.listSlides`, `page.get`) and 4 write (`presentation.create`, `presentation.replaceText`, `presentation.batchUpdate`, `page.getThumbnail`). `page.getThumbnail` is marked write conservatively because it can download and write PNG bytes to local `savePath`. |
| `googleTasks` | done | Annotated 12 actions: 4 read (`taskList.list`, `taskList.get`, `task.get`, `task.list`) and 8 write (taskList/task create/update/delete plus task move/clear). |
| `gotify` | done | Annotated 3 actions: 1 read (`message.list`) and 2 write (`message.create`, `message.delete`). |
| `gotowebinar` | done | Annotated 20 actions: 11 read (webinar/registrant/session/attendee/coorganizer/panelist get/list/performance actions) and 9 write (webinar create/update/delete, registrant create/delete, coorganizer create/delete, panelist create/delete). |
| `grafana` | done | Annotated 17 actions: 6 read (`dashboard.get`, `dashboard.list`, `team.get`, `team.list`, `teamMember.list`, `user.list`) and 11 write (dashboard/team/user create/update/delete plus teamMember add/remove). |
| `graphql` | done | Annotated 2 actions: 1 read (`introspect`) and 1 write (`query`). `query` is marked write conservatively because the query string can contain GraphQL mutations or other side-effecting operations. |
| `grist` | done | Annotated 4 actions: 1 read (`record.list`) and 3 write (`record.create`, `record.update`, `record.delete`). |
| `hackernews` | done | Annotated 6 actions: all read (`article.get`, `article.search`, `user.get`, `all.top`, `all.new`, `all.best`). |
| `halopsa` | done | Annotated 20 runtime actions via CRUD helper: 8 read (client/site/ticket/user get/list) and 12 write (client/site/ticket/user create/update/delete). |
| `harvest` | done | Annotated 49 runtime actions via CRUD helper and direct registrations: 20 read (CRUD get/list for 8 resources plus `user.me`, `timeEntry.get`, `timeEntry.list`, `company.get`) and 29 write (CRUD create/update/delete plus time entry create/update/delete/restart/stop). |
| `helpscout` | done | Annotated 13 actions: 8 read (`conversation.get`, `conversation.list`, `customer.get`, `customer.list`, `customer.getProperties`, `mailbox.get`, `mailbox.list`, `thread.list`) and 5 write (`conversation.create`, `conversation.delete`, `customer.create`, `customer.update`, `thread.create`). |
| `highlevel` | done | Annotated 17 actions: 7 read (`contact.get`, `contact.list`, `opportunity.get`, `opportunity.list`, `task.get`, `task.list`, `calendar.getFreeSlots`) and 10 write (contact upsert/update/delete, opportunity create/update/delete, task create/update/delete, calendar appointment booking). |
| `homeAssistant` | done | Annotated 13 actions: 10 read (config/service/state/event/log/template/history get/list/check/render actions) and 3 write (`service.call`, `state.set`, `event.fire`). `config.check` and `template.render` are read because they validate/render without mutating Home Assistant state. |
| `hubspot` | done | Annotated 32 runtime actions via CRM helper and direct registrations: 15 read (CRM get/list/search for contact/company/deal/ticket plus engagement get/list and form fields) and 17 write (CRM create/update/delete, contact list add/remove, engagement create/delete, form submit). |
| `humanticAi` | done | Annotated 3 actions: 1 read (`profile.get`) and 2 write (`profile.create`, `profile.update`) because create/update POST profile data for external analysis/storage. |
| `hunter` | done | Annotated 3 actions: all read (`domainSearch`, `emailFinder`, `emailVerifier`) using Hunter lookup/verification GET endpoints. |
| `intercom` | done | Annotated 10 actions: 6 read (`contact.get`, `contact.list`, `contact.search`, `company.get`, `company.list`, `company.listUsers`) and 4 write (`contact.create`, `contact.update`, `contact.delete`, `company.create`). |
| `iterable` | done | Annotated 6 actions: 1 read (`user.get`) and 5 write (`event.track`, `user.upsert`, `user.delete`, `userList.add`, `userList.remove`). |
| `jenkins` | done | Annotated 11 actions: 2 read (`job.getParameters`, `build.list`) and 9 write (`job.trigger`, `job.copy`, `job.create`, and instance quiet/restart/exit controls). |
| `jira` | done | Annotated 16 actions: 8 read (`issue.get`, `issue.search`, transitions/changelog/comment/user get/list/search actions) and 8 write (issue create/update/delete/transition/notify plus comment add/update/delete). `issue.search` is read despite POST because it only queries Jira via the JQL search endpoint. |
| `keap` | done | Annotated 28 actions: 12 read (company/contact/note/tag/order/product/email/file get/list actions) and 16 write (company/contact/note/tag/order/product/email/file create/upsert/update/delete/add/remove/send actions). |
| `kobotoolbox` | done | Annotated 17 actions: 10 read (form/submission/hook/file get/list/log/validation reads) and 7 write (`form.redeploy`, `submission.delete`, `submission.setValidation`, hook retry actions, `file.delete`, `file.createFromUrl`). |
| `lemlist` | done | Annotated 15 actions: 8 read (`activity.list`, `campaign.list`, `campaign.getStats`, `lead.get`, `team.get`, `team.getCredits`, `unsubscribe.list`, `enrich.get`) and 7 write (`lead.create`, `lead.delete`, `lead.unsubscribe`, unsubscribe add/delete, enrichment trigger actions). Enrichment trigger actions are marked write because they POST to start external enrichment processing. |
| `linear` | done | Annotated 88 runtime actions across modular source files: 37 read (helper-expanded get/list/search/members/me plus attachment/comment/issue/org/view reads) and 51 write (create/update/delete/archive/restore/subscribe/link/webhook/user mutations). Helper registration sites in `shared.ts` and `views.ts` are read for generated list/get/view-connection actions. |
| `lingvanex` | done | Annotated 1 action: 1 write (`translate`). Marked write conservatively because it POSTs text to external translation processing. |
| `linkedin` | done | Annotated 1 action: 1 write (`post.create`) because it publishes a LinkedIn post via POST. |
| `lonescale` | done | Annotated 4 actions: 1 read (`list.list`) and 3 write (`list.create`, `item.addPerson`, `item.addCompany`). |
| `magento` | done | Annotated 15 actions: 6 read (customer/order/product get/list actions) and 9 write (customer/product create/update/delete, invoice create, order cancel/ship). |
| `mailcheck` | done | Annotated 1 action: 1 write (`email.check`). Marked write conservatively because it POSTs to external verification processing. |
| `mailchimp` | done | Annotated 14 actions: 5 read (`member.get`, `member.list`, `listGroup.list`, `campaign.get`, `campaign.list`) and 9 write (member create/update/delete, tag add/remove, campaign send/replicate/resend/delete). |
| `mailerlite` | done | Annotated 4 actions: 2 read (`subscriber.get`, `subscriber.list`) and 2 write (`subscriber.create`, `subscriber.update`). |
| `mailgun` | done | Annotated 1 action: 1 write (`email.send`) because it sends email via Mailgun. |
| `mailjet` | done | Annotated 3 actions: 3 write (`email.send`, `email.sendTemplate`, `sms.send`) because they send email/SMS messages. |
| `mandrill` | done | Annotated 2 actions: 2 write (`message.sendHtml`, `message.sendTemplate`) because they send email via Mandrill. |
| `marketstack` | done | Annotated 3 actions: 3 read (`endOfDayData.list`, `exchange.get`, `ticker.get`). |
| `matrix` | done | Annotated 10 actions: 4 read (`account.me`, `message.list`, `event.get`, `roomMember.list`) and 6 write (room create/join/leave/invite/kick and `message.create`). |
| `mattermost` | done | Annotated 19 actions: 7 read (`channel.members`, `channel.search`, `channel.statistics`, `reaction.list`, user list/get actions including POST-based `user.getByIds`) and 12 write (channel create/delete/add/restore, message post/delete/ephemeral, reaction create/delete, user create/deactivate/invite). |
| `mautic` | done | Annotated 20 actions: 4 read (company/contact get/list actions) and 16 write (company/contact create/update/delete, contact email/DNC/points edits, segment/campaign/company membership changes, segment email send). |
| `medium` | done | Annotated 3 actions: 2 read (`publication.list`, `me`) and 1 write (`post.create`). |
| `messagebird` | done | Annotated 2 actions: 1 read (`balance.get`) and 1 write (`sms.send`) because it sends SMS messages. |
| `metabase` | done | Annotated 10 actions: 9 read (question/alert/database/metric get/list/fields/results actions) and 1 write (`database.add`). `question.getResults` is read despite POST because it runs/retrieves query results. |
| `microsoftCalendar` | done | Annotated 2 actions: 2 read (`calendar.list`, `event.get`). |
| `microsoftFiles` | done | Annotated 5 actions: 3 read (`files.search`, `files.list`, `files.get`) and 2 write (`files.upload`, `folder.create`). |
| `microsoftMail` | done | Annotated 4 actions: 2 read (`mail.list`, `mail.get`) and 2 write (`mail.send`, `mail.draft`). |
| `misp` | done | Annotated 44 actions: 20 read (get/list/search actions across attributes, events, feeds, galaxies, noticelists, objects, organisations, tags, users, warninglists) and 24 write (create/update/delete, publish/unpublish, tag/feed enable/disable, membership/tag mutations). POST-based restSearch actions are read because they query data. |
| `mocean` | done | Annotated 2 actions: 2 write (`sms.send`, `voice.send`) because they send SMS messages and initiate voice calls. |
| `monday` | done | Annotated 18 actions: 7 read (board/column/group/item get/list/search actions) and 11 write (board/column/group/item create/archive/delete/move/update/comment/column value mutations). |
| `monicaCrm` | done | Annotated 45 helper-expanded CRUD actions across 9 resources: 18 read (get/list) and 27 write (create/update/delete). |
| `msg91` | done | Annotated 1 action: 1 write (`sms.send`) because it sends SMS messages. |
| `nasa` | done | Annotated 14 runtime actions: 14 read (APOD, asteroid, DONKI, and Earth asset retrieval actions). Helper loop for 8 DONKI endpoints annotated read. |
| `netlify` | done | Annotated 7 actions: 4 read (`deploy.get`, `deploy.list`, `site.get`, `site.list`) and 3 write (`deploy.cancel`, `deploy.create`, `site.delete`). |
| `netscalerAdc` | done | Annotated 3 actions: 3 write (`certificate.create`, `certificate.install`, `file.delete`) because they create/install/delete appliance resources. |
| `nextcloud` | done | Annotated 13 actions: 2 read (`user.get`, `user.list`) and 11 write (file/folder copy/delete/move/share/create plus user create/delete/update). |
| `nocodb` | done | Annotated 5 actions: 2 read (`row.get`, `row.list`) and 3 write (`row.create`, `row.update`, `row.delete`). |
| `node` | done | Annotated 38 action definitions: 28 read (filesystem reads/stats/access checks, path/os/process env/cwd, crypto value/hash helpers) and 10 write (filesystem write/mutate actions, process execution, and generic `fetch`). `fetch` is marked write because arbitrary HTTP methods/bodies may cause external side effects. |
| `notion` | done | Annotated 14 actions: 9 read (block children, database get/list/query, page get/search, user get/list/me) and 5 write (block append/delete, page create/update/archive). POST-based search/query actions are read because they retrieve data. |
| `npm` | done | Annotated 5 actions: 4 read (`package.getMetadata`, `package.getVersions`, `package.search`, `distTag.list`) and 1 write (`distTag.update`). |
| `odoo` | done | Annotated 6 actions: 3 read (`record.get`, `record.list`, `model.getFields`) and 3 write (`record.create`, `record.update`, `record.delete`). |
| `okta` | done | Annotated 5 actions: 2 read (`user.get`, `user.list`) and 3 write (`user.create`, `user.update`, `user.delete`). |
| `oneSimpleApi` | done | Annotated 10 actions: 7 read (SEO/social profile/exchange rate/image metadata/email validation/URL expansion retrieval actions) and 3 write (`website.pdf`, `website.screenshot`, `utility.qrCode`). Generation actions are marked write conservatively because they create external artifacts/URLs. |
| `onfleet` | done | Annotated 34 runtime actions: 14 read (organization/task/resource get/list, hub list, container get, team time estimates, destination get) and 20 write (task/resource/hub/recipient/container/team/destination create/update/delete/complete/dispatch mutations). Helper CRUD sites cover worker/admin/team get/list as read and create/update/delete as write. |
| `openai` | done | Annotated 1 action: 1 write (`image.create`) because it triggers external image generation and writes generated PNG files to disk. |
| `openThesaurus` | done | Annotated 1 action: 1 read (`synonyms.get`). |
| `openweathermap` | done | Annotated 2 actions: 2 read (`weather.current`, `weather.forecast5day`). |
| `oura` | done | Annotated 4 runtime actions: 4 read (`profile.get` plus 3 summary endpoints). Helper loop for activity/readiness/sleep summaries annotated read. |
| `paddle` | done | Annotated 9 actions: 6 read (`coupon.list`, `payment.list`, plan get/list, product list, user list) and 3 write (`coupon.create`, `coupon.update`, `payment.reschedule`). Paddle read endpoints use POST bodies but retrieve data. |
| `pagerduty` | done | Annotated 9 actions: 6 read (`incident.get`, `incident.list`, `incidentNote.list`, log entry get/list, `user.get`) and 3 write (`incident.create`, `incident.update`, `incidentNote.create`). |
| `parallel` | done | Annotated 1 action: 1 read (`search`). POST-based search is read because it retrieves live web results/excerpts without mutating user resources. |
| `paypal` | done | Annotated 4 actions: 2 read (`payout.get`, `payoutItem.get`) and 2 write (`payout.create`, `payoutItem.cancel`). |
| `peekalink` | done | Annotated 2 actions: 2 read (`link.preview`, `link.isAvailable`). POST-based preview checks are read because they retrieve URL metadata/availability. |
| `phantombuster` | done | Annotated 5 actions: 3 read (`agent.get`, `agent.getOutput`, `agent.list`) and 2 write (`agent.delete`, `agent.launch`). |
| `philipsHue` | done | Annotated 4 actions: 2 read (`light.get`, `light.list`) and 2 write (`light.update`, `light.delete`). |
| `pipedrive` | done | Annotated 47 runtime actions: 21 read (CRUD get/list/search plus deal product list and file get) and 26 write (CRUD create/update/delete/duplicate plus deal product add/update/remove and file update/delete). Helper CRUD sites cover 7 resources with optional search/duplicate expansions. |
| `plivo` | done | Annotated 3 actions: 3 write (`sms.send`, `mms.send`, `call.make`) because they send messages or initiate phone calls. |
| `postbin` | done | Annotated 6 actions: 2 read (`bin.get`, `request.get`) and 4 write (`bin.create`, `bin.delete`, `request.removeFirst`, `request.send`). `request.removeFirst` is write because it removes a request from the bin. |
| `posthog` | done | Annotated 5 actions: 5 write (`alias.create`, `event.create`, `identity.create`, `track.page`, `track.screen`) because they capture events or mutate identity/alias analytics state. |
| `profitwell` | done | Annotated 2 actions: 2 read (`company.getSettings`, `metric.get`). |
| `pushbullet` | done | Annotated 4 actions: 1 read (`push.list`) and 3 write (`push.create`, `push.delete`, `push.update`). |
| `pushcut` | done | Annotated 1 action: 1 write (`notification.send`) because it sends a Pushcut notification. |
| `pushover` | done | Annotated 1 action: 1 write (`message.push`) because it sends a push notification. |
| `quickbase` | done | Annotated 8 actions: 4 read (`field.list`, `record.query`, `report.get`, `report.run`) and 4 write (`file.delete`, `record.create`, `record.delete`, `record.upsert`). POST-based query/report run actions are read because they retrieve records/report results. |
| `quickbooks` | done | Annotated 45 helper-expanded actions across 9 resources: 18 read (get/query) and 27 write (create/update/delete). |
| `quickchart` | done | Annotated 1 action: 1 write (`chart.create`). Marked write conservatively because it generates an external chart image URL/artifact. |
| `raindrop` | done | Annotated 13 actions: 6 read (bookmark/collection/tag/user get/list actions) and 7 write (bookmark/collection create/update/delete and `tag.delete`). |
| `recraft` | done | Annotated 1 action: 1 write (`image.create`) because it triggers external image generation and writes generated image files to disk. |
| `reddit` | done | Annotated 10 actions: 5 read (`post.get`, `post.list`, `post.search`, `subreddit.get`, `user.get`) and 5 write (`post.create`, `post.delete`, `comment.create`, `comment.reply`, `comment.delete`). |
| `replicate` | done | Annotated 1 action: 1 write (`image.create`) because it creates external predictions and writes generated image files to disk. |
| `rocketchat` | done | Annotated 1 action: 1 write (`chat.postMessage`) because it posts a message. |
| `rundeck` | done | Annotated 2 actions: 1 read (`job.getMetadata`) and 1 write (`job.execute`) because it triggers a Rundeck job run. |
| `salesforce` | done | Annotated 63 runtime actions across modular source files: 34 read (connection/auth/limits/metadata, SOQL query/page actions, standard sObject get/query/queryPage, generic get/describe) and 29 write (standard/generic sObject create/update/delete/upsert). Helper sites in `sobjects.ts` cover 7 standard sObject resources. |
| `salesmate` | done | Annotated 15 helper-expanded CRUD actions across 3 resources: 6 read (get/list) and 9 write (create/update/delete). POST-based list/search actions are read because they retrieve data. |
| `securityScorecard` | done | Annotated 14 actions: 8 read (company/industry scorecard and list/get actions, portfolio/list company listing, report listing) and 6 write (portfolio create/delete, portfolio company add/remove, invite create, report generate). |
| `segment` | done | Annotated 4 actions: 4 write (`identify.create`, `track.event`, `track.page`, `group.add`) because they send analytics events or mutate identity/group association state. |
| `sendgrid` | done | Annotated 10 actions: 4 read (`contact.get`, `contact.list`, `list.get`, `list.list`) and 6 write (`mail.send`, contact upsert/delete, list create/update/delete). POST-based contact search actions are read because they retrieve contact data. |
| `sendy` | done | Annotated 6 actions: 2 read (`subscriber.count`, `subscriber.status`) and 4 write (`campaign.create`, `subscriber.add`, `subscriber.delete`, `subscriber.unsubscribe`). |
| `sentry` | done | Annotated 21 explicit actions plus 3 unused CRUD helper registration sites: 12 explicit read (event/issue/org/project/release/team get/list) and 9 explicit write (issue update/delete; organization/project/release/team create/delete). Helper sites marked get/list read and delete write. |
| `servicenow` | done | Annotated 40 actions: 16 read (get/list across 7 table resources plus generic tableRecord get/list) and 24 write (create/update/delete across table resources plus generic tableRecord create/update/delete). |
| `shiftCrm` | done | Annotated 40 actions across modular source files: 22 read (access me/list, account/person/opportunity/task list/listPage/get, activity list/listPage, pipeline list/get, propertyDefinition.list, record.changeEvents, import list/get) and 18 write (access grant/revoke, account/person/opportunity/task create/update, activity.log, pipeline/propertyDefinition create, import create/stageRows/commitRow/skipRow/commit). |
| `shiftLabs` | done | Annotated 47 actions across modular source files, most recently the objects service: 5 read (`object.get/list/links/download/bucket` — download mints a signed grant and optionally saves to disk) and 3 write (`object.upload/attach/archive`), alongside the existing project, issue, issueView, page, and transcription actions. |
| `shiftOcr` | done | Annotated 2 actions: 1 read (`ocr.providers`) and 1 write (`ocr.extract` — marked write because it spends metered provider capacity on the Shift cloud OCR service). |
| `shopify` | done | Annotated 10 actions: 4 read (`order.get/list`, `product.get/list`) and 6 write (order/product create/update/delete). |
| `signl4` | done | Annotated 2 actions: 2 write (`alert.send`, `alert.resolve`) because they send/resolve external SIGNL4 alerts via webhook. |
| `slack` | done | Annotated 38 actions: 16 read (message permalink/search; channel get/list/history/replies/members; reaction get; user info/list/presence/profile; userGroup list; file get/list; star list) and 22 write (message post/update/delete; channel create/invite/kick/join/leave/archive/unarchive/rename/setTopic/setPurpose; reaction add/remove; user profile update; userGroup create/update/enable/disable; star add/remove). |
| `sms77` | done | Annotated 2 actions: 2 write (`sms.send`, `voice.send`) because they send SMS/voice messages through seven. |
| `splunk` | done | Annotated 16 actions: 9 read (search get/list/results, alert metrics/fired, report get/list, user get/list) and 7 write (search create/delete, report create/delete, user create/update/delete). `search.create` is write because it executes/creates a Splunk search job. |
| `spotify` | done | Annotated 30 actions: 20 read (currently/recently played, album/artist/playlist/track/library/myData get/list/search actions) and 10 write (player pause/resume/next/previous/addToQueue/setVolume/startMusic, playlist create/addTrack/removeTrack). |
| `stackby` | done | Annotated 4 actions: 2 read (`row.read`, `row.list`) and 2 write (`row.append`, `row.delete`). |
| `steel` | done | Annotated 44 actions across modular source files: 18 read (status/list/get/download/context/traces/events/hls/cdpUrl actions) and 26 write (scrape/screenshot/pdf/browser.run, captcha solve, create/update/delete/upload/release/computer actions). Browser scrape/screenshot/pdf/extract marked write conservatively because they execute external browser work and may create hosted artifacts. |
| `storyblok` | done | Annotated 7 actions: 4 read (content and management story get/list) and 3 write (`management.story.delete`, `management.story.publish`, `management.story.unpublish`). Publish/unpublish are write despite GET transport because they mutate story publication state. |
| `strapi` | done | Annotated 5 actions: 2 read (`entry.get`, `entry.list`) and 3 write (`entry.create`, `entry.update`, `entry.delete`). |
| `strava` | done | Annotated 9 runtime actions: 7 read (`activity.get/list`, 4 helper-expanded activity subresource getters, `activity.getStreams`) and 2 write (`activity.create`, `activity.update`). |
| `stripe` | done | Annotated 20 actions: 8 read (balance get; customer/charge list/get; coupon list; customerCard/source get) and 12 write (customer/charge/coupon/source/token/meterEvent create/update/delete/add/remove actions). |
| `supabase` | done | Annotated 5 actions: 2 read (`row.get`, `row.list`) and 3 write (`row.create`, `row.update`, `row.delete`). |
| `syncromsp` | done | Annotated 20 actions: 8 read (customer/contact/ticket/rmmAlert get/list) and 12 write (create/update/delete plus `rmmAlert.mute`). |
| `tapfiliate` | done | Annotated 11 actions: 4 read (affiliate/programAffiliate get/list) and 7 write (affiliate create/delete, metadata set/delete, programAffiliate add/approve/disapprove). |
| `telegram` | done | Annotated 21 actions: 4 read (`chat.get`, `chat.getAdministrators`, `chat.getMember`, `file.get`) and 17 write (message send/edit/delete/pin/unpin/media/chatAction, chat leave/set, callback answer). Telegram read APIs use POST transport but only retrieve metadata. |
| `thehive` | done | Annotated 23 actions: 10 read (alert/case/observable/task/log get/list) and 13 write (create/update, alert mark read/unread/promote/merge). POST query endpoints are read where they only retrieve data. |
| `thehiveProject` | done | Annotated 37 runtime actions: 14 read (explicit get/timeline/query actions plus 7 helper-expanded search actions) and 23 write (create/update/delete/merge/promote/status/comment/log/page mutations). Raw `query.execute` and helper search actions are read because they use TheHive Query API for retrieval. |
| `todoist` | done | Annotated 31 actions: 11 read (task/project/section/comment/label get/list plus `project.getCollaborators`) and 20 write (create/update/delete/close/reopen/quickAdd/archive/unarchive actions). |
| `together` | done | Annotated 1 action: 1 write (`image.create`) because it triggers external image generation and writes generated image files to disk. |
| `travisci` | done | Annotated 5 actions: 2 read (`build.get`, `build.list`) and 3 write (`build.cancel`, `build.restart`, `build.trigger`) because they cancel/restart/trigger CI builds. |
| `trello` | done | Annotated 37 actions: 12 read (board/card/list/attachment/checklist/label get/list actions plus boardMember list and list cards) and 25 write (create/update/delete/add/remove actions across boards, members, cards, comments, lists, attachments, checklists, items, and labels). |
| `twake` | done | Annotated 1 action: 1 write (`message.send`) because it sends a message to a Twake channel. |
| `twilio` | done | Annotated 2 actions: 2 write (`sms.send`, `call.make`) because they send messages/place calls through Twilio. |
| `twist` | done | Annotated 22 actions: 8 read (channel/thread/comment/messageConversation get/list) and 14 write (create/update/delete/archive/unarchive/send actions). |
| `twitter` | done | Annotated 8 actions: 2 read (`tweet.search`, `user.get`) and 6 write (`tweet.create`, `tweet.delete`, `tweet.like`, `tweet.retweet`, `list.addMember`, `dm.create`) because they post/delete/like/retweet/add/send in Twitter/X. |
| `unleashedSoftware` | done | Annotated 3 actions: 3 read (`salesOrder.list`, `stockOnHand.list`, `stockOnHand.get`) because they only retrieve sales order and stock data. |
| `uplead` | done | Annotated 2 actions: 2 write (`person.enrich`, `company.enrich`) because enrichment can consume external provider resources/credits despite using GET retrieval endpoints. |
| `uproc` | done | Annotated 1 action: 1 write (`process.run`) because it executes an external uProc processor and may trigger an async webhook callback. |
| `uptimerobot` | done | Annotated 22 actions: 9 read (account get plus monitor/alertContact/maintenanceWindow/publicStatusPage get/list) and 13 write (create/update/delete/reset actions). UptimeRobot read APIs use POST transport but only retrieve data. |
| `urlscanio` | done | Annotated 3 actions: 2 read (`scan.get`, `scan.search`) and 1 write (`scan.perform`) because it submits a URL for external scanning. |
| `vercel` | done | Annotated 14 runtime actions across modular source files: 10 read (`whoami`, project/deployment/env list/get/domains/logs/runtimeLogs plus 2 helper get actions) and 4 write (`deployment.cancel`, `deployment.promote`, `env.set`, `env.delete`). |
| `vero` | done | Annotated 8 runtime actions: 8 write (user create/alias/unsubscribe/resubscribe/delete/addTags/removeTags and event track). All actions mutate user state or track events in Vero. |
| `vonage` | done | Annotated 1 action: 1 write (`sms.send`) because it sends SMS messages through Vonage and may trigger a delivery callback webhook. |
| `wekan` | done | Annotated 24 actions: 11 read (board/list/card/cardComment/checklist/checklistItem get/list actions) and 13 write (create/update/delete actions). |
| `woocommerce` | done | Annotated 15 helper-expanded CRUD actions across 3 resources: 6 read (get/list) and 9 write (create/update/delete). |
| `wordpress` | done | Annotated 15 runtime actions: 6 read (post/page/user get/list) and 9 write (post/page/user create/update/delete). |
| `xai` | done | Annotated 1 action: 1 write (`image.create`) because it triggers external image generation and writes generated image files to disk. |
| `xero` | done | Annotated 8 actions: 4 read (`invoice.get`, `invoice.list`, `contact.get`, `contact.list`) and 4 write (`invoice.create`, `invoice.update`, `contact.create`, `contact.update`). |
| `yourls` | done | Annotated 3 actions: 2 read (`url.expand`, `url.stats`) and 1 write (`url.shorten`) because it creates a short URL mapping. |
| `zammad` | done | Annotated 22 runtime actions: 10 read (CRUD get/list across 3 resources, ticket get/list, user getSelf/search) and 12 write (CRUD create/update/delete across 3 resources plus ticket create/update/delete). |
| `zendesk` | done | Annotated 18 actions: 9 read (ticket/user/organization/ticketField get/list/search actions) and 9 write (ticket/user/organization create/update/delete actions). |
| `zoho` | done | Annotated 60 helper-expanded CRM actions across 10 modules: 20 read (get/list) and 40 write (create/update/delete/upsert). |
| `zoom` | done | Annotated 5 actions: 2 read (`meeting.get`, `meeting.list`) and 3 write (`meeting.create`, `meeting.update`, `meeting.delete`). |
| `zulip` | done | Annotated 15 actions: 5 read (`message.get`, stream list actions, user get/list) and 10 write (message send/update/delete, stream create/update/delete, user create/update/deactivate). |

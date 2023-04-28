#!/usr/bin/env node

// ------------------------
// Loading .env and env variables
const config = require("dotenv").config().parsed;
// Overwrite env variables anyways
for (const k in config) {
  process.env[k] = config[k];
}

// Open a URL in the default web browser
const open = require("open");

if (!process.env.NOTION_API_TOKEN) {
  open("https://www.notion.so/my-integrations");
  console.error(
    'This tool requires a valid Notion API token. Head to https://www.notion.so/my-integrations, create a new app with "Read Content" and "Insert Content" in "Content Capabilities" section, plus "Read user information without email addresses" in "User Capabilities" section, and then share your Notion page with the app. Once you get a token, set NOTION_API_TOKEN env variable to the token value.'
  );
  process.exit(1);
}
if (!process.env.DEEPL_API_TOKEN) {
  open("https://www.deepl.com/pro-api");
  console.error(
    "This tool requires a DeepL API token. Head to https://www.deepl.com/pro-api, sign up, and grab your API token. Once you get a token, set DEEPL_API_TOKEN env variable to the token value."
  );
  process.exit(1);
}

// ------------------------
// DeepL API Client

const deepl = require("deepl-node");
// Note that developer account is required for this
const translator = new deepl.Translator(process.env.DEEPL_API_TOKEN);

async function translateText(richTextArray, from, to) {
  for (const each of richTextArray) {
    if (each.plain_text) {
      const result = await translator.translateText(each.plain_text, from, to);
      each.plain_text = result.text;
      if (each.text) {
        each.text.content = each.plain_text;
      }
    }
  }
}

// https://www.deepl.com/docs-api/translating-text/request/
const supportedFromLangs = [
  "BG", // Bulgarian
  "CS", // Czech
  "DA", // Danish
  "DE", // German
  "EL", // Greek
  "EN", // English
  "ES", // Spanish
  "ET", // Estonian
  "FI", // Finnish
  "FR", // French
  "HU", // Hungarian
  "ID", // Indonesian
  "IT", // Italian
  "JA", // Japanese
  "LT", // Lithuanian
  "LV", // Latvian
  "NL", // Dutch
  "PL", // Polish
  "PT", // Portuguese (all Portuguese varieties mixed)
  "RO", // Romanian
  "RU", // Russian
  "SK", // Slovak
  "SL", // Slovenian
  "SV", // Swedish
  "TR", // Turkish
  "ZH", // Chinese
];

const supportedToLangs = [
  "BG", // Bulgarian
  "CS", // Czech
  "DA", // Danish
  "DE", // German
  "EL", // Greek
  "EN-GB", // English (British)
  "EN-US", // English (American)
  "ES", // Spanish
  "ET", // Estonian
  "FI", // Finnish
  "FR", // French
  "HU", // Hungarian
  "ID", // Indonesian
  "IT", // Italian
  "JA", // Japanese
  "LT", // Lithuanian
  "LV", // Latvian
  "NL", // Dutch
  "PL", // Polish
  "PT-PT", // Portuguese (all Portuguese varieties excluding Brazilian Portuguese)
  "PT-BR", // Portuguese (Brazilian)
  "RO", // Romanian
  "RU", // Russian
  "SK", // Slovak
  "SL", // Slovenian
  "SV", // Swedish
  "TR", // Turkish
  "ZH", // Chinese
];
const databases = [];

const translationOfSelectOptions = true;

const printableSupportedFromLangs = supportedFromLangs
  .map((l) => l.toLowerCase())
  .join(",");
const printableSupportedToLangs = supportedToLangs
  .map((l) => l.toLowerCase())
  .join(",");

// ------------------------
// Utilities

if (!Array.prototype.last) {
  Array.prototype.last = function () {
    return this[this.length - 1];
  };
}

function toPrettifiedJSON(obj) {
  return JSON.stringify(obj, null, 2);
}

// Removes unnecessary block properties for new creation
function removeUnecessaryProperties(obj) {
  delete obj.id;
  delete obj.created_time;
  delete obj.last_edited_time;
  delete obj.created_by;
  delete obj.last_edited_by;
}

// ------------------------
// CLI

const { Command } = require("commander");
const program = new Command();

program
  .name("notion-translator")
  .description("CLI to translate a Notion page to a different language")
  .requiredOption("-u, --url <https://www.notion.so/...>")
  .requiredOption(`-f, --from <${printableSupportedFromLangs}>`)
  .requiredOption(`-t, --to <${printableSupportedToLangs}>`)
  .option("-d, --debug");

program.showHelpAfterError();

program.parse();

const options = program.opts();
const { url, from, to, debug } = options;

if (!supportedFromLangs.includes(from.toUpperCase())) {
  console.error(
    `\nERROR: ${from.toUpperCase()} is not a supported language code.\n\nPass any of ${supportedFromLangs}\n`
  );
  process.exit(1);
}

if (!supportedToLangs.includes(to.toUpperCase())) {
  console.error(
    `\nERROR: ${to.toUpperCase()} is not a supported language code.\n\nPass any of ${supportedToLangs}\n`
  );
  process.exit(1);
}

// ------------------------
// Notion API Client

const { Client, LogLevel } = require("@notionhq/client");
const notion = new Client({
  auth: process.env.NOTION_API_TOKEN,
  logLevel: debug ? LogLevel.DEBUG : LogLevel.ERROR,
});

if (debug) {
  console.log(`Passed options: ${JSON.stringify(options, null, 2)}`);
}

// ------------------------
// Main code

async function buildTranslatedBlocks(id, newPage, nestedDepth) {
  const translatedBlocks = [];
  let cursor;
  let hasMore = true;
  while (hasMore) {
    const blocks = await notion.blocks.children.list({
      block_id: id,
      start_cursor: cursor,
      page_size: 100, // max 100
    });
    if (debug) {
      console.log(
        `Fetched original blocks: ${JSON.stringify(blocks.results, null, 2)}`
      );
    }
    // Print dot for the user that is waiting for the completion
    process.stdout.write(".");

    for (const result of blocks.results) {
      var b = result;
      if (nestedDepth >= 2) {
        b.has_children = false;
      }
      if (nestedDepth == 1) {
        if (b.type === "column_list") {
          // If this column_list block is already in the one-level nested children,
          // its children (= column blocks) are unable to have children
          b.column_list.children = [];
          continue;
        }
      }
      if (b.type === "unsupported") {
        continue;
      }
      if (b.type === "file") {
        if (b.file.type === "external") {
          if (!b.file.url || b.file.url.trim().length === 0) {
            // The API endpoint for 3rd parties rejects the empty external file URL pattern even though it can exist
            continue;
          }
        } else {
          // The file blocks do not work in a copied page
          const notice = [
            {
              plain_text: "(The file was removed from this page)",
              text: { content: "" },
            },
          ];
          await translateText(notice, "en", to);
          b = {
            type: "paragraph",
            paragraph: {
              color: "default",
              rich_text: notice,
            },
          };
        }
      }
      if (b.type === "table") {
        const notice = [
          {
            plain_text: "(The table was removed from this page)",
            text: { content: "" },
          },
        ];
        await translateText(notice, "en", to);
        b = {
          type: "table",
          table: {
            table_width:        b.table.table_width,
            has_column_header:  b.table.has_column_header,
            has_row_header:     b.table.has_row_header
          },
          has_children: true,
          id: b.id,
        };

      }
      if (b.type === 'table_row') {
        // translate each cell
        for (const row of b.table_row.cells) {
          await translateText(row, from, to);
        }
        b = {
          has_children: false,
          archived: false,
          type: 'table_row',
          table_row: { cells: b.table_row.cells }
        };
      }
      if (b.type === "image") {
        if (b.image.type !== "external") {
          // The image blocks with internal URLs may not work in a copied page
          // See https://github.com/seratch/notion-translator/issues/1 for more details
          const notice = [
            {
              plain_text: "(The image was removed from this page)",
              text: { content: "" },
            },
          ];
          await translateText(notice, "en", to);
          b = {
            type: "paragraph",
            paragraph: {
              color: "default",
              rich_text: notice,
            },
          };
        }
      }
      if (b.type === "child_page") {
        // Convert a child_page in the original page to link_to_page
        try {
          b.type = "link_to_page";
          const page = await notion.pages.retrieve({ page_id: b.id });
          b.link_to_page = {
            type: "page_id",
            page_id: page.id,
          };
          delete b.child_page;
          b.has_children = false;
        } catch (e) {
          if (debug) {
            console.log(
              `Failed to load a page (error: ${e}) - Skipped this block.`
            );
          }
          continue;
        }
      } else if (b.type === "child_database") {
          // Tweak to keep id from wiping
          b.internal_db_id = b.id;

      } else if (b.has_children) {
        if (nestedDepth >= 3) {
          // https://developers.notion.com/reference/patch-block-children
          // > For blocks that allow children, we allow up to two levels of nesting in a single request.
          continue;
        }
        // Recursively call this method for nested children blocks
        b[b.type].children = await buildTranslatedBlocks(b.id, newPage, nestedDepth + 1);
      }
      removeUnecessaryProperties(b);
      // Translate all the text parts in this nest level
      for (const [_, v] of Object.entries(b)) {
        if (v instanceof Object) {
          for (const [key, value] of Object.entries(v)) {
            if (key === "caption" || (key === "rich_text" && b.type !== "code")) {
              await translateText(value, from, to);
            }
          }
        }
      }
      // Add this valid block to the result
      translatedBlocks.push(b);
    }

    // For pagination
    if (blocks.has_more) {
      cursor = blocks.next_cursor;
    } else {
      hasMore = false;
    }
  }
  return translatedBlocks;
}

async function createNewPageForTranslation(originalPage) {
  const newPage = JSON.parse(JSON.stringify(originalPage)); // Create a deep copy
  // Create the translated page as a child of the original page
  newPage.parent = { page_id: originalPage.id };
  const originalTitle = originalPage.properties.title ? originalPage.properties.title.title[0] : "Translated page";
  const newTitle = newPage.properties.title.title[0];
  newTitle.text.content = originalTitle.text.content + ` (${to})`;
  newTitle.plain_text = originalTitle.plain_text + ` (${to})`;
  removeUnecessaryProperties(newPage);

  if (debug) {
    console.log(
      `New page creation request params: ${toPrettifiedJSON(newPage)}`
    );
  }
  const newPageCreation = await notion.pages.create(newPage);
  if (debug) {
    console.log(
      `New page creation response: ${toPrettifiedJSON(newPageCreation)}`
    );
  }
  return newPageCreation;
}

(async function () {
  let originalPage;
  const contentId = url.split("/").last().split("-").last();
  try {
    originalPage = await notion.pages.retrieve({ page_id: contentId });
  } catch (e) {
    try {
      await notion.databases.retrieve({ database_id: contentId });
      console.error(
        "\nERROR: This URL is a database. This tool currently supports only pages.\n"
      );
    } catch (_) {
      console.error(
        `\nERROR: Failed to read the page content!\n\nError details: ${e}\n\nPlease make sure the following:\n * The page is shared with your app\n * The API token is the one for this workspace\n`
      );
    }
    process.exit(1);
  }
  if (debug) {
    console.log(`The page metadata: ${toPrettifiedJSON(originalPage)}`);
  }

  process.stdout.write(
    `\nWait a minute! Now translating the following Notion page:\n${url}\n\n(this may take some time) ...`
  );
  const newPage = await createNewPageForTranslation(originalPage);
  const translatedBlocks = await buildTranslatedBlocks(originalPage.id, newPage, 0);
  const blocksAppendParams = {
    block_id: newPage.id,
    children: translatedBlocks,
  };
  if (debug) {
    console.log(
      `Block creation request params: ${toPrettifiedJSON(blocksAppendParams)}`
    );
  }

  // const pageSize = 10;
  // let beginIndex = 0;
  // let endIndex = 0;
  // do {
  //   beginIndex = endIndex;
  //   endIndex = (beginIndex + pageSize) < translatedBlocks.length ? beginIndex + pageSize : translatedBlocks.length;
  //   const reducedBlocks = translatedBlocks.slice(beginIndex, endIndex);

  //   const blocksAppendParams = {
  //     block_id: newPage.id,
  //     children: reducedBlocks,
  //   };

  //   const blocksAddition = await notion.blocks.children.append(blocksAppendParams);
  //   if (debug) {
  //     console.log(`Block creation response: ${toPrettifiedJSON(blocksAddition)}`);
  //   }
  // } while(endIndex < translatedBlocks.length);


  for (const block of translatedBlocks) {
    if (block.type === "child_database") {
      await duplicateDatabase(block.internal_db_id, newPage.id);
    } else {
      const blocksAppendParams = {
        block_id: newPage.id,
        children: [block],
      };
      const blocksAddition = await notion.blocks.children.append(blocksAppendParams);
      if (debug) {
        console.log(`Block creation response: ${toPrettifiedJSON(blocksAddition)}`);
      }
    }
  }

  console.log(
    "... Done!\n\nDisclaimer:\nSome parts might not be perfect.\nIf the generated page is missing something, please adjust the details on your own.\n"
  );
  console.log(`Here is the translated Notion page:\n${newPage.url}\n`);
  open(newPage.url);
})();

async function duplicateDatabase(originalDatabaseId, parentId) {
  if (parentId === undefined) {
      console.log('ParentId is null. Abort.');
      process.exit(1);
  }
  try {
    // Retrieve the properties of the original database
    const originalDatabase = await notion.databases.retrieve({
      database_id: originalDatabaseId,
    });
    for (let key in originalDatabase.properties) {
      let value = originalDatabase.properties[key];

      if (value['type'] === 'multi_select') {
        // Translating options ?
        if (translationOfSelectOptions) {
          for (let selectOption of value['multi_select'].options) {
            const translated =  await translator.translateText(selectOption.name, from, to);
            selectOption.name = translated.text;
          }
        }
      } else if (value['type'] === 'rich_text') {
          // Translating options ?
          if (translationOfSelectOptions) {
            console.log(value['rich_text']);
            //await translateText(value, from, to);

            // for (let selectOption of value['multi_select'].options) {
            //   console.log(selectOption.name);
            //   const translated =  await translator.translateText(selectOption.name, from, to);
            //   selectOption.name = translated.text;
            // }
          }
      }
      for (let key2 in value) {
        let value2 = value[key2];
        if (key2 === 'name') {
          const translated =  await translator.translateText(value2, from, to);
          value[key2] = translated.text;
        }
        if (key2 === 'rich_text') {
          console.log(`Rich text ${ value['name']}`);
          //value[key2] = value['name'];
        }

      }
    }

    const duplicateDatabaseName =  originalDatabase.title[0].plain_text;

    // Create a new database with the same properties as the original database
    const newDatabase = await notion.databases.create({
      parent: { page_id: parentId },
      title: [{ text: { content: duplicateDatabaseName } }],
      properties: originalDatabase.properties,
    });
    databases.push(newDatabase);

    // Iterate through the pages in the original database
    const originalPages = await notion.databases.query({
      database_id: originalDatabaseId,
    });

    for (const originalPage of originalPages.results) {
      const newPageS = JSON.parse(JSON.stringify(originalPage)); // Create a deep copy
      removeUnecessaryProperties(newPageS);

      newPageS.parent.database_id = newDatabase.id;
      for (let key in newPageS.properties) {
        let value =  newPageS.properties[key];
        for (let key2 in value) {
          let value2 = value[key2];
          if (key2 === 'id') {
            value[key2] = undefined;
          }
          if (key2 === 'select') {
            for (let keyOfSelect in value[key2]) {
              if (keyOfSelect !== 'name') {
                value[key2][keyOfSelect] = undefined;
              } else {
                const translated =  await translator.translateText(value[key2][keyOfSelect], from, to);
                  value[key2][keyOfSelect] = translated.text;
              }
            }
          }
          else if (key2 === 'multi_select') {
            for (let keyOfSelect in value[key2]) {
              let selectedValue =  value[key2][keyOfSelect];
              for (let properties in selectedValue) {
                if (properties !== 'name') {
                  selectedValue[properties] = undefined;
                } else {
                  const translated =  await translator.translateText(selectedValue[properties], from, to);
                  selectedValue[properties] = translated.text;
                }
              }
            }
          } else if (key2 === 'rich_text') {
            if (value[key2][0] !== undefined) {
              const translated =  await translator.translateText(value[key2][0]['text']['content'], from, to);
              value[key2][0]['text']['content'] = translated.text;
            }
          } else if (key2 === 'title') {
            const translated =  await translator.translateText(value[key2][0]['plain_text'], from, to);
            value[key2][0]['text']['content'] = translated.text;
          }
        }
      }

      // Create a new page in the duplicate database
      const newPage = await notion.pages.create(
        {
        parent: { database_id: newDatabase.id},
          properties : newPageS.properties
        },

      );
      console.log(`Created new page with ID ${newPage.id}`);
    }
  } catch (error) {
    console.error(error);
  }
}

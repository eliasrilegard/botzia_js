use std::collections::HashMap;

use serde::Deserialize;
use tokio::fs::File;

use serenity::async_trait;
use serenity::builder::{CreateApplicationCommandOption, CreateEmbed};
use serenity::model::application::interaction::autocomplete::AutocompleteInteraction;
use serenity::model::prelude::AttachmentType;
use serenity::model::prelude::command::CommandOptionType;
use serenity::model::prelude::interaction::application_command::ApplicationCommandInteraction;
use serenity::prelude::Context;

use crate::color::Colors;
use crate::commands::SlashSubCommand;
use crate::database::Database;
use crate::interaction::{BetterResponse, InteractionCustomGet, AutocompleteCustomGet};
use crate::Result;

#[derive(Deserialize)]
struct QuoteData {
  name: String,
  file: String
}

pub struct Quote {
  quote_map: HashMap<String, String>
}

impl Default for Quote {
  fn default() -> Self {
    let quotes_json = include_str!("../../../assets/dungeon_defenders/quotes/quotemap.json");
    let quotes: Vec<QuoteData> = serde_json::from_str(quotes_json).expect("JSON was not well formatted");
    let quote_map = quotes.iter().map(|quote| (quote.name.clone(), quote.file.clone())).collect::<HashMap<_, _>>();
    
    Self { quote_map }
  }
}

#[async_trait]
impl SlashSubCommand for Quote {
  fn register<'a>(&self, subcommand: &'a mut CreateApplicationCommandOption) -> &'a mut CreateApplicationCommandOption {
    subcommand
      .kind(CommandOptionType::SubCommand)
      .name("quote")
      .description("Post a legendary quote from the DD community")
      .create_sub_option(|option| option
        .kind(CommandOptionType::String)
        .name("quote")
        .description("The quote to post")
        .set_autocomplete(true)
        .required(true)
      )
  }

  async fn execute(&self, ctx: &Context, interaction: &ApplicationCommandInteraction, _: &Database) -> Result<()> {
    let key = interaction.get_string("quote").unwrap();

    if !self.quote_map.contains_key(&key) {
      let mut embed = CreateEmbed::default();
      embed
        .color(Colors::RED)
        .title("Quote not found")
        .description("Could not identify the quote");

      interaction.reply(&ctx.http, |msg| msg.set_embed(embed)).await?;
      return Ok(());
    }

    let quote_name = self.quote_map.get(&key).unwrap();
    let quote = File::open(format!("assets/dungeondefenders/quotes/img/{}", quote_name)).await?;
    let image = AttachmentType::File {
      file: &quote,
      filename: quote_name.into()
    };

    interaction.reply(&ctx.http, |msg| msg.add_file(image)).await?;
    Ok(())
  }

  async fn autocomplete(&self, ctx: &Context, interaction: &AutocompleteInteraction, _: &Database) -> Result<()> {
    let focused_value = if let Some(value) = interaction.get_focused_option().value {
      value.as_str().unwrap_or("").to_ascii_lowercase().replace(" ", "")
    } else { "".to_string() };

    interaction.create_autocomplete_response(&ctx.http, |response| {
      let mut keys = self.quote_map.keys().collect::<Vec<_>>();
      keys.sort();

      for &key in keys.iter() {
        if key.contains(&focused_value) {
          response.add_string_choice(key, key);
        }
      }
      
      response
    }).await?;

    Ok(())
  }
}
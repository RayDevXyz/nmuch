//! A minimal in-process event bus. Subscribers get every committed change, after the
//! update log and the index have both been written.

use std::sync::mpsc::{channel, Receiver, Sender};

use serde::Serialize;

use crate::schema::PageId;

/// Where a committed change came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Origin {
    /// Made through [`crate::Core::transact`] (core logic, modules, widgets).
    Local,
    /// A yrs update produced elsewhere (an editor's Y.Doc) and handed to
    /// [`crate::Core::apply_update`].
    Remote,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Event {
    PageCreated {
        page_id: PageId,
        seq: i64,
    },
    PageChanged {
        page_id: PageId,
        seq: i64,
        origin: Origin,
    },
    PageDeleted {
        page_id: PageId,
    },
    IndexRebuilt {
        pages: usize,
    },
}

#[derive(Default)]
pub(crate) struct EventBus {
    subscribers: Vec<Sender<Event>>,
}

impl EventBus {
    pub fn subscribe(&mut self) -> Receiver<Event> {
        let (tx, rx) = channel();
        self.subscribers.push(tx);
        rx
    }

    /// Deliver to every live subscriber; dropped receivers are forgotten.
    pub fn emit(&mut self, event: Event) {
        self.subscribers.retain(|s| s.send(event.clone()).is_ok());
    }
}
